#![no_std]

//! FarmPay escrow: holds a buyer's USDC for a farm order and pays the farmer
//! on confirmation, after the review window, or by arbiter decision.
//! See README.md for the full specification.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, String,
};

#[cfg(test)]
mod test;

// Storage lifetimes (TTL), in ledgers. Ledgers close roughly every 5 seconds;
// converting time to ledgers at 5s slightly over-estimates, which errs on the
// side of keeping data live. Every TTL is capped at the network's maximum.
const SECONDS_PER_LEDGER: u64 = 5;
const DAY_IN_LEDGERS: u32 = 17_280;
/// The contract instance and code are extended to 90 days whenever they drop below 30.
const INSTANCE_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
/// An order always stays live at least this long after its last update.
const ORDER_MIN_TTL: u32 = 30 * DAY_IN_LEDGERS;
/// Extra time after an order's next deadline, so the next party can still act.
const ORDER_TTL_BUFFER: u32 = 14 * DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    OrderNotFound = 1,
    InvalidAmount = 2,
    InvalidParties = 3,
    InvalidDeadline = 4,
    InvalidStatus = 5,
    TooEarly = 6,
    TooLate = 7,
    InvalidSplit = 8,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Funded,
    Accepted,
    Delivered,
    Disputed,
    Released,
    Refunded,
    Resolved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub id: u64,
    pub buyer: Address,
    pub farmer: Address,
    pub arbiter: Address,
    pub amount: i128,
    pub delivery_deadline: u64,
    pub review_window: u64,
    pub review_deadline: u64,
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    NextId,
    Order(u64),
}

/// Emitted on every status change; the backend indexes these to build delivery histories.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusChanged {
    #[topic]
    pub order_id: u64,
    pub status: OrderStatus,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeOpened {
    #[topic]
    pub order_id: u64,
    pub reason: String,
}

#[contract]
pub struct FarmPayEscrow;

#[contractimpl]
impl FarmPayEscrow {
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::NextId, &1u64);
        extend_instance(&env);
    }

    /// Buyer creates an order and moves `amount` of the escrow token into the contract.
    pub fn create_order(
        env: Env,
        buyer: Address,
        farmer: Address,
        arbiter: Address,
        amount: i128,
        delivery_deadline: u64,
        review_window: u64,
    ) -> Result<u64, Error> {
        buyer.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if buyer == farmer || buyer == arbiter || farmer == arbiter {
            return Err(Error::InvalidParties);
        }
        if delivery_deadline <= env.ledger().timestamp() || review_window == 0 {
            return Err(Error::InvalidDeadline);
        }

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap();
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        token_client(&env).transfer(&buyer, env.current_contract_address(), &amount);

        let order = Order {
            id,
            buyer,
            farmer,
            arbiter,
            amount,
            delivery_deadline,
            review_window,
            review_deadline: 0,
            status: OrderStatus::Funded,
        };
        save(&env, &order);
        Ok(id)
    }

    /// Farmer accepts a funded order.
    pub fn accept_order(env: Env, order_id: u64) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        order.farmer.require_auth();
        expect_status(&order, OrderStatus::Funded)?;

        order.status = OrderStatus::Accepted;
        save(&env, &order);
        Ok(())
    }

    /// Buyer cancels for a full refund: any time before acceptance,
    /// or after the delivery deadline if the farmer hasn't delivered.
    pub fn cancel_order(env: Env, order_id: u64) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        order.buyer.require_auth();

        match order.status {
            OrderStatus::Funded => {}
            OrderStatus::Accepted => {
                if env.ledger().timestamp() <= order.delivery_deadline {
                    return Err(Error::TooEarly);
                }
            }
            _ => return Err(Error::InvalidStatus),
        }

        token_client(&env).transfer(&env.current_contract_address(), &order.buyer, &order.amount);
        order.status = OrderStatus::Refunded;
        save(&env, &order);
        Ok(())
    }

    /// Farmer marks the order delivered, which starts the review window.
    pub fn mark_delivered(env: Env, order_id: u64) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        order.farmer.require_auth();
        expect_status(&order, OrderStatus::Accepted)?;

        order.review_deadline = env.ledger().timestamp().saturating_add(order.review_window);
        order.status = OrderStatus::Delivered;
        save(&env, &order);
        Ok(())
    }

    /// Buyer confirms delivery and the farmer is paid.
    pub fn confirm_delivery(env: Env, order_id: u64) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        order.buyer.require_auth();
        expect_status(&order, OrderStatus::Delivered)?;

        release_to_farmer(&env, &mut order);
        Ok(())
    }

    /// Anyone can release payment to the farmer once the review window has passed.
    pub fn claim_payment(env: Env, order_id: u64) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        expect_status(&order, OrderStatus::Delivered)?;
        if env.ledger().timestamp() <= order.review_deadline {
            return Err(Error::TooEarly);
        }

        release_to_farmer(&env, &mut order);
        Ok(())
    }

    /// Buyer disputes the delivery while the review window is open.
    pub fn open_dispute(env: Env, order_id: u64, reason: String) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        order.buyer.require_auth();
        expect_status(&order, OrderStatus::Delivered)?;
        if env.ledger().timestamp() > order.review_deadline {
            return Err(Error::TooLate);
        }

        order.status = OrderStatus::Disputed;
        save(&env, &order);
        DisputeOpened { order_id, reason }.publish(&env);
        Ok(())
    }

    /// Arbiter pays `farmer_amount` to the farmer and refunds the rest to the buyer.
    pub fn resolve_dispute(env: Env, order_id: u64, farmer_amount: i128) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        order.arbiter.require_auth();
        expect_status(&order, OrderStatus::Disputed)?;
        if farmer_amount < 0 || farmer_amount > order.amount {
            return Err(Error::InvalidSplit);
        }

        let token = token_client(&env);
        let contract = env.current_contract_address();
        let buyer_amount = order.amount - farmer_amount;
        if farmer_amount > 0 {
            token.transfer(&contract, &order.farmer, &farmer_amount);
        }
        if buyer_amount > 0 {
            token.transfer(&contract, &order.buyer, &buyer_amount);
        }

        order.status = OrderStatus::Resolved;
        save(&env, &order);
        Ok(())
    }

    pub fn get_order(env: Env, order_id: u64) -> Result<Order, Error> {
        load(&env, order_id)
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }
}

fn token_client(env: &Env) -> token::Client<'_> {
    let address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
    token::Client::new(env, &address)
}

fn load(env: &Env, order_id: u64) -> Result<Order, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Order(order_id))
        .ok_or(Error::OrderNotFound)
}

fn save(env: &Env, order: &Order) {
    let key = DataKey::Order(order.id);
    env.storage().persistent().set(&key, order);
    let ttl = order_ttl(env, order);
    env.storage().persistent().extend_ttl(&key, ttl, ttl);
    extend_instance(env);
    StatusChanged {
        order_id: order.id,
        status: order.status,
    }
    .publish(env);
}

/// How long an order must stay live: until its next deadline has passed plus a
/// buffer for the next party to act, and never less than `ORDER_MIN_TTL`.
fn order_ttl(env: &Env, order: &Order) -> u32 {
    let now = env.ledger().timestamp();
    let next_deadline = match order.status {
        // The farmer may deliver up to the deadline, then the review window runs.
        OrderStatus::Funded | OrderStatus::Accepted => {
            order.delivery_deadline.saturating_add(order.review_window)
        }
        OrderStatus::Delivered => order.review_deadline,
        // Disputes have no deadline; terminal orders are kept for history reads.
        _ => now,
    };
    let ledgers = next_deadline.saturating_sub(now) / SECONDS_PER_LEDGER;
    let ttl = u32::try_from(ledgers)
        .unwrap_or(u32::MAX)
        .saturating_add(ORDER_TTL_BUFFER)
        .max(ORDER_MIN_TTL);
    ttl.min(env.storage().max_ttl())
}

/// Keeps the contract instance and code live, so the contract stays callable.
fn extend_instance(env: &Env) {
    let max = env.storage().max_ttl();
    let extend_to = INSTANCE_TTL_EXTEND_TO.min(max);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD.min(extend_to), extend_to);
}

fn expect_status(order: &Order, status: OrderStatus) -> Result<(), Error> {
    if order.status == status {
        Ok(())
    } else {
        Err(Error::InvalidStatus)
    }
}

fn release_to_farmer(env: &Env, order: &mut Order) {
    token_client(env).transfer(
        &env.current_contract_address(),
        &order.farmer,
        &order.amount,
    );
    order.status = OrderStatus::Released;
    save(env, order);
}
