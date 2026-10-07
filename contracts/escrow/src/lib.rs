#![no_std]

//! FarmPay escrow: holds a buyer's USDC for a farm order and pays the farmer
//! on confirmation, after the review window, or by arbiter decision.
//! See README.md for the full specification.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, String,
};

#[cfg(test)]
mod test;

// Persistent entries live ~30 days without activity and are bumped on every write.
const DAY_IN_LEDGERS: u32 = 17_280;
const ORDER_TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const ORDER_TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;

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

        token_client(&env).transfer(&buyer, &env.current_contract_address(), &amount);

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
    env.storage()
        .persistent()
        .extend_ttl(&key, ORDER_TTL_THRESHOLD, ORDER_TTL_EXTEND_TO);
    StatusChanged {
        order_id: order.id,
        status: order.status,
    }
    .publish(env);
}

fn expect_status(order: &Order, status: OrderStatus) -> Result<(), Error> {
    if order.status == status {
        Ok(())
    } else {
        Err(Error::InvalidStatus)
    }
}

fn release_to_farmer(env: &Env, order: &mut Order) {
    token_client(env).transfer(&env.current_contract_address(), &order.farmer, &order.amount);
    order.status = OrderStatus::Released;
    save(env, order);
}
