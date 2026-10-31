#![cfg(test)]

use super::*;
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};

const AMOUNT: i128 = 10_000_000_000; // 1,000 USDC (7 decimals)
const DELIVERY_DEADLINE: u64 = 10_000;
const REVIEW_WINDOW: u64 = 3 * 24 * 60 * 60;
const DISPUTE_WINDOW: u64 = 7 * 24 * 60 * 60;

struct Setup<'a> {
    env: Env,
    client: FarmPayEscrowClient<'a>,
    token: TokenClient<'a>,
    buyer: Address,
    farmer: Address,
    arbiter: Address,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let issuer = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(issuer);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let arbiter = Address::generate(&env);
    StellarAssetClient::new(&env, &usdc.address()).mint(&buyer, &AMOUNT);

    let contract_id = env.register(FarmPayEscrow, (usdc.address(),));
    let client = FarmPayEscrowClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &usdc.address());

    Setup {
        env,
        client,
        token,
        buyer,
        farmer,
        arbiter,
    }
}

impl Setup<'_> {
    fn create(&self) -> u64 {
        self.client.create_order(
            &self.buyer,
            &self.farmer,
            &self.arbiter,
            &AMOUNT,
            &DELIVERY_DEADLINE,
            &REVIEW_WINDOW,
            &DISPUTE_WINDOW,
        )
    }

    fn delivered(&self) -> u64 {
        let id = self.create();
        self.client.accept_order(&id);
        self.client.mark_delivered(&id);
        id
    }

    fn status(&self, id: u64) -> OrderStatus {
        self.client.get_order(&id).status
    }

    fn last_signer(&self) -> Address {
        self.env.auths().last().unwrap().0.clone()
    }
}

#[test]
fn create_order_locks_funds() {
    let s = setup();
    let id = s.create();

    assert_eq!(id, 1);
    assert_eq!(s.last_signer(), s.buyer);
    assert_eq!(s.status(id), OrderStatus::Funded);
    assert_eq!(s.token.balance(&s.buyer), 0);
    assert_eq!(s.token.balance(&s.client.address), AMOUNT);
}

#[test]
fn create_order_validates_input() {
    let s = setup();
    let create = |buyer: &Address, farmer: &Address, amount: i128, deadline: u64, window: u64| {
        s.client.try_create_order(
            buyer,
            farmer,
            &s.arbiter,
            &amount,
            &deadline,
            &window,
            &DISPUTE_WINDOW,
        )
    };

    assert_eq!(
        create(&s.buyer, &s.farmer, 0, DELIVERY_DEADLINE, REVIEW_WINDOW),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        create(&s.buyer, &s.buyer, AMOUNT, DELIVERY_DEADLINE, REVIEW_WINDOW),
        Err(Ok(Error::InvalidParties))
    );
    assert_eq!(
        create(
            &s.buyer,
            &s.arbiter,
            AMOUNT,
            DELIVERY_DEADLINE,
            REVIEW_WINDOW
        ),
        Err(Ok(Error::InvalidParties))
    );
    assert_eq!(
        create(&s.buyer, &s.farmer, AMOUNT, 1_000, REVIEW_WINDOW),
        Err(Ok(Error::InvalidDeadline))
    );
    assert_eq!(
        create(&s.buyer, &s.farmer, AMOUNT, DELIVERY_DEADLINE, 0),
        Err(Ok(Error::InvalidDeadline))
    );
}

#[test]
fn dispute_window_must_be_within_bounds() {
    let s = setup();
    let create = |dispute_window: u64| {
        s.client.try_create_order(
            &s.buyer,
            &s.farmer,
            &s.arbiter,
            &1,
            &DELIVERY_DEADLINE,
            &REVIEW_WINDOW,
            &dispute_window,
        )
    };

    assert_eq!(create(0), Err(Ok(Error::InvalidDeadline)));
    assert_eq!(
        create(MIN_DISPUTE_WINDOW - 1),
        Err(Ok(Error::InvalidDeadline))
    );
    assert_eq!(
        create(MAX_DISPUTE_WINDOW + 1),
        Err(Ok(Error::InvalidDeadline))
    );
    assert!(create(MIN_DISPUTE_WINDOW).is_ok());
    assert!(create(MAX_DISPUTE_WINDOW).is_ok());
}

#[test]
fn happy_path_buyer_confirms() {
    let s = setup();
    let id = s.create();

    s.client.accept_order(&id);
    assert_eq!(s.last_signer(), s.farmer);
    assert_eq!(s.status(id), OrderStatus::Accepted);

    s.client.mark_delivered(&id);
    assert_eq!(s.last_signer(), s.farmer);
    let order = s.client.get_order(&id);
    assert_eq!(order.status, OrderStatus::Delivered);
    assert_eq!(order.review_deadline, 1_000 + REVIEW_WINDOW);

    s.client.confirm_delivery(&id);
    assert_eq!(s.last_signer(), s.buyer);
    assert_eq!(s.status(id), OrderStatus::Released);
    assert_eq!(s.token.balance(&s.farmer), AMOUNT);
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn farmer_claims_after_review_window() {
    let s = setup();
    let id = s.delivered();
    let deadline = s.client.get_order(&id).review_deadline;

    s.env.ledger().set_timestamp(deadline);
    assert_eq!(s.client.try_claim_payment(&id), Err(Ok(Error::TooEarly)));

    s.env.ledger().set_timestamp(deadline + 1);
    s.client.claim_payment(&id);
    assert_eq!(s.status(id), OrderStatus::Released);
    assert_eq!(s.token.balance(&s.farmer), AMOUNT);
}

#[test]
fn buyer_cancels_before_acceptance() {
    let s = setup();
    let id = s.create();

    s.client.cancel_order(&id);
    assert_eq!(s.last_signer(), s.buyer);
    assert_eq!(s.status(id), OrderStatus::Refunded);
    assert_eq!(s.token.balance(&s.buyer), AMOUNT);
    assert_eq!(
        s.client.try_accept_order(&id),
        Err(Ok(Error::InvalidStatus))
    );
}

#[test]
fn buyer_cancels_accepted_order_only_after_delivery_deadline() {
    let s = setup();
    let id = s.create();
    s.client.accept_order(&id);

    s.env.ledger().set_timestamp(DELIVERY_DEADLINE);
    assert_eq!(s.client.try_cancel_order(&id), Err(Ok(Error::TooEarly)));

    s.env.ledger().set_timestamp(DELIVERY_DEADLINE + 1);
    s.client.cancel_order(&id);
    assert_eq!(s.status(id), OrderStatus::Refunded);
    assert_eq!(s.token.balance(&s.buyer), AMOUNT);
}

#[test]
fn cannot_cancel_after_delivery() {
    let s = setup();
    let id = s.delivered();
    assert_eq!(
        s.client.try_cancel_order(&id),
        Err(Ok(Error::InvalidStatus))
    );
}

#[test]
fn dispute_resolved_with_split() {
    let s = setup();
    let id = s.delivered();

    s.client
        .open_dispute(&id, &String::from_str(&s.env, "Short by 200kg"));
    assert_eq!(s.last_signer(), s.buyer);
    assert_eq!(s.status(id), OrderStatus::Disputed);
    assert_eq!(
        s.client.try_claim_payment(&id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        s.client.try_confirm_delivery(&id),
        Err(Ok(Error::InvalidStatus))
    );

    let farmer_share = AMOUNT * 8 / 10;
    s.client.resolve_dispute(&id, &farmer_share);
    assert_eq!(s.last_signer(), s.arbiter);
    assert_eq!(s.status(id), OrderStatus::Resolved);
    assert_eq!(s.token.balance(&s.farmer), farmer_share);
    assert_eq!(s.token.balance(&s.buyer), AMOUNT - farmer_share);
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn dispute_resolution_allows_full_refund() {
    let s = setup();
    let id = s.delivered();
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "Nothing arrived"));

    s.client.resolve_dispute(&id, &0);
    assert_eq!(s.token.balance(&s.buyer), AMOUNT);
    assert_eq!(s.token.balance(&s.farmer), 0);
}

#[test]
fn dispute_split_is_bounded() {
    let s = setup();
    let id = s.delivered();
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "Wrong grade"));

    assert_eq!(
        s.client.try_resolve_dispute(&id, &-1),
        Err(Ok(Error::InvalidSplit))
    );
    assert_eq!(
        s.client.try_resolve_dispute(&id, &(AMOUNT + 1)),
        Err(Ok(Error::InvalidSplit))
    );
}

#[test]
fn dispute_must_be_within_review_window() {
    let s = setup();
    let id = s.delivered();
    let deadline = s.client.get_order(&id).review_deadline;

    s.env.ledger().set_timestamp(deadline + 1);
    assert_eq!(
        s.client
            .try_open_dispute(&id, &String::from_str(&s.env, "Too late")),
        Err(Ok(Error::TooLate))
    );
}

#[test]
fn state_transitions_are_enforced() {
    let s = setup();
    let id = s.create();

    assert_eq!(
        s.client.try_mark_delivered(&id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        s.client.try_confirm_delivery(&id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        s.client
            .try_open_dispute(&id, &String::from_str(&s.env, "x")),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        s.client.try_resolve_dispute(&id, &0),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(s.client.try_get_order(&99), Err(Ok(Error::OrderNotFound)));
}

#[test]
fn order_ids_increment() {
    let s = setup();
    StellarAssetClient::new(&s.env, &s.token.address).mint(&s.buyer, &AMOUNT);
    assert_eq!(s.create(), 1);
    assert_eq!(s.create(), 2);
}

#[test]
#[should_panic]
fn accept_requires_farmer_auth() {
    let s = setup();
    let id = s.create();
    s.env.set_auths(&[]);
    s.client.accept_order(&id);
}

// ---------- Storage lifetime (TTL) ----------

const DAY: u64 = 24 * 60 * 60;

fn ledgers(seconds: u64) -> u32 {
    (seconds / SECONDS_PER_LEDGER) as u32
}

impl Setup<'_> {
    fn stored_order_ttl(&self, id: u64) -> u32 {
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().get_ttl(&DataKey::Order(id))
        })
    }

    fn instance_ttl(&self) -> u32 {
        self.env.as_contract(&self.client.address, || {
            self.env.storage().instance().get_ttl()
        })
    }

    fn ttl_for(&self, order: &Order) -> u32 {
        self.env
            .as_contract(&self.client.address, || order_ttl(&self.env, order))
    }

    fn order_with(&self, status: OrderStatus, delivery_in: u64, review_window: u64) -> Order {
        let now = self.env.ledger().timestamp();
        Order {
            id: 1,
            buyer: self.buyer.clone(),
            farmer: self.farmer.clone(),
            arbiter: self.arbiter.clone(),
            amount: AMOUNT,
            delivery_deadline: now + delivery_in,
            review_window,
            review_deadline: if status == OrderStatus::Delivered {
                now + review_window
            } else {
                0
            },
            dispute_window: DISPUTE_WINDOW,
            dispute_deadline: if status == OrderStatus::Disputed {
                now + DISPUTE_WINDOW
            } else {
                0
            },
            status,
        }
    }
}

#[test]
fn open_order_lives_until_delivery_and_review_plus_buffer() {
    let s = setup();
    for status in [OrderStatus::Funded, OrderStatus::Accepted] {
        let order = s.order_with(status, 120 * DAY, 3 * DAY);
        assert_eq!(s.ttl_for(&order), ledgers(123 * DAY) + ORDER_TTL_BUFFER);
    }
}

#[test]
fn delivered_order_lives_until_review_deadline_plus_buffer() {
    let s = setup();
    let order = s.order_with(OrderStatus::Delivered, 0, 60 * DAY);
    assert_eq!(s.ttl_for(&order), ledgers(60 * DAY) + ORDER_TTL_BUFFER);
}

#[test]
fn short_lived_disputed_and_finished_orders_get_the_minimum() {
    let s = setup();
    let soon = s.order_with(OrderStatus::Funded, DAY, DAY);
    assert_eq!(s.ttl_for(&soon), ORDER_MIN_TTL);
    for status in [
        OrderStatus::Released,
        OrderStatus::Refunded,
        OrderStatus::Resolved,
    ] {
        let order = s.order_with(status, 120 * DAY, 3 * DAY);
        assert_eq!(s.ttl_for(&order), ORDER_MIN_TTL);
    }
}

#[test]
fn order_ttl_is_capped_at_the_network_maximum() {
    let s = setup();
    s.env.ledger().set_max_entry_ttl(100 * DAY_IN_LEDGERS);
    let order = s.order_with(OrderStatus::Funded, 300 * DAY, 3 * DAY);
    let max = s
        .env
        .as_contract(&s.client.address, || s.env.storage().max_ttl());
    assert_eq!(s.ttl_for(&order), max);
}

#[test]
fn create_order_stores_the_lifecycle_ttl() {
    let s = setup();
    let deadline = s.env.ledger().timestamp() + 120 * DAY;
    let id = s.client.create_order(
        &s.buyer,
        &s.farmer,
        &s.arbiter,
        &AMOUNT,
        &deadline,
        &REVIEW_WINDOW,
        &DISPUTE_WINDOW,
    );
    assert_eq!(
        s.stored_order_ttl(id),
        ledgers(120 * DAY + REVIEW_WINDOW) + ORDER_TTL_BUFFER
    );
}

#[test]
fn contract_instance_is_extended_after_long_inactivity() {
    let s = setup();
    assert_eq!(s.instance_ttl(), INSTANCE_TTL_EXTEND_TO);

    // A long-dated order, so it is still live after the idle period.
    let deadline = s.env.ledger().timestamp() + 120 * DAY;
    let id = s.client.create_order(
        &s.buyer,
        &s.farmer,
        &s.arbiter,
        &AMOUNT,
        &deadline,
        &REVIEW_WINDOW,
        &DISPUTE_WINDOW,
    );

    // 65 idle days: the instance drops below the 30-day threshold...
    let seq = s.env.ledger().sequence();
    s.env
        .ledger()
        .set_sequence_number(seq + 65 * DAY_IN_LEDGERS);
    assert_eq!(
        s.instance_ttl(),
        INSTANCE_TTL_EXTEND_TO - 65 * DAY_IN_LEDGERS
    );

    // ...and the next state change brings it back to 90 days.
    s.client.accept_order(&id);
    assert_eq!(s.instance_ttl(), INSTANCE_TTL_EXTEND_TO);
}

// ---------- Dispute deadline: a missing arbiter can never lock funds ----------

impl Setup<'_> {
    fn disputed(&self) -> u64 {
        let id = self.delivered();
        self.client
            .open_dispute(&id, &String::from_str(&self.env, "Short by 200kg"));
        id
    }
}

#[test]
fn opening_a_dispute_starts_the_arbiters_clock() {
    let s = setup();
    let id = s.delivered();
    assert_eq!(s.client.get_order(&id).dispute_deadline, 0);

    s.env.ledger().set_timestamp(2_000);
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "Wrong grade"));

    let order = s.client.get_order(&id);
    assert_eq!(order.dispute_window, DISPUTE_WINDOW);
    assert_eq!(order.dispute_deadline, 2_000 + DISPUTE_WINDOW);
}

#[test]
fn arbiter_can_rule_up_to_the_deadline_but_not_after() {
    let s = setup();
    let id = s.disputed();
    let deadline = s.client.get_order(&id).dispute_deadline;

    s.env.ledger().set_timestamp(deadline + 1);
    assert_eq!(
        s.client.try_resolve_dispute(&id, &AMOUNT),
        Err(Ok(Error::TooLate))
    );
    assert_eq!(s.status(id), OrderStatus::Disputed);

    // Exactly at the deadline the arbiter still may.
    s.env.ledger().set_timestamp(deadline);
    s.client.resolve_dispute(&id, &(AMOUNT / 4));
    assert_eq!(s.status(id), OrderStatus::Resolved);
    assert_eq!(s.token.balance(&s.farmer), AMOUNT / 4);
}

#[test]
fn nobody_can_settle_by_default_before_the_deadline() {
    let s = setup();
    let id = s.disputed();
    let deadline = s.client.get_order(&id).dispute_deadline;

    s.env.ledger().set_timestamp(1_001);
    assert_eq!(s.client.try_expire_dispute(&id), Err(Ok(Error::TooEarly)));
    s.env.ledger().set_timestamp(deadline);
    assert_eq!(s.client.try_expire_dispute(&id), Err(Ok(Error::TooEarly)));
    assert_eq!(s.status(id), OrderStatus::Disputed);
    assert_eq!(s.token.balance(&s.client.address), AMOUNT);
}

#[test]
fn an_unanswered_dispute_settles_evenly_and_anyone_can_trigger_it() {
    let s = setup();
    let id = s.disputed();
    let deadline = s.client.get_order(&id).dispute_deadline;

    s.env.ledger().set_timestamp(deadline + 1);
    // No signature from any party: a stranger (or a bot) can pay the fee to settle.
    s.env.set_auths(&[]);
    s.client.expire_dispute(&id);

    assert_eq!(s.status(id), OrderStatus::Resolved);
    assert_eq!(s.token.balance(&s.farmer), AMOUNT / 2);
    assert_eq!(s.token.balance(&s.buyer), AMOUNT / 2);
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn an_odd_amount_is_split_without_losing_a_unit() {
    let s = setup();
    let odd = AMOUNT - 1; // 9_999_999_999
    let id = s.client.create_order(
        &s.buyer,
        &s.farmer,
        &s.arbiter,
        &odd,
        &DELIVERY_DEADLINE,
        &REVIEW_WINDOW,
        &DISPUTE_WINDOW,
    );
    s.client.accept_order(&id);
    s.client.mark_delivered(&id);
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "Short"));
    let deadline = s.client.get_order(&id).dispute_deadline;

    s.env.ledger().set_timestamp(deadline + 1);
    s.client.expire_dispute(&id);

    // The farmer gets the rounded-down half; the buyer gets the rest plus the 1 unit never spent.
    assert_eq!(s.token.balance(&s.farmer), odd / 2);
    assert_eq!(s.token.balance(&s.buyer), (odd - odd / 2) + 1);
    assert_eq!(s.token.balance(&s.client.address), 0);
}

#[test]
fn a_single_unit_order_goes_to_the_buyer_without_a_zero_transfer() {
    let s = setup();
    let id = s.client.create_order(
        &s.buyer,
        &s.farmer,
        &s.arbiter,
        &1,
        &DELIVERY_DEADLINE,
        &REVIEW_WINDOW,
        &DISPUTE_WINDOW,
    );
    s.client.accept_order(&id);
    s.client.mark_delivered(&id);
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "Short"));
    let deadline = s.client.get_order(&id).dispute_deadline;

    s.env.ledger().set_timestamp(deadline + 1);
    s.client.expire_dispute(&id);
    assert_eq!(s.token.balance(&s.farmer), 0);
    assert_eq!(s.status(id), OrderStatus::Resolved);
}

#[test]
fn only_a_disputed_order_can_expire_and_it_can_only_end_once() {
    let s = setup();
    let id = s.create();
    for status_step in 0..3 {
        // Funded, then Accepted, then Delivered: none of them is a dispute.
        assert_eq!(
            s.client.try_expire_dispute(&id),
            Err(Ok(Error::InvalidStatus))
        );
        match status_step {
            0 => s.client.accept_order(&id),
            1 => s.client.mark_delivered(&id),
            _ => {}
        }
    }

    // A ruling and the default settlement are mutually exclusive.
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "Short"));
    s.client.resolve_dispute(&id, &0);
    s.env.ledger().set_timestamp(10_000_000_000);
    assert_eq!(
        s.client.try_expire_dispute(&id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(s.token.balance(&s.buyer), AMOUNT);

    let other = setup();
    let id = other.disputed();
    let deadline = other.client.get_order(&id).dispute_deadline;
    other.env.ledger().set_timestamp(deadline + 1);
    other.client.expire_dispute(&id);
    assert_eq!(
        other.client.try_expire_dispute(&id),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        other.client.try_resolve_dispute(&id, &0),
        Err(Ok(Error::InvalidStatus))
    );
}

#[test]
fn a_disputed_order_stays_live_until_its_dispute_deadline_plus_buffer() {
    let s = setup();

    // A long dispute window outlasts the 30-day minimum, so it sets the lifetime.
    let mut long = s.order_with(OrderStatus::Disputed, 0, 3 * DAY);
    long.dispute_window = MAX_DISPUTE_WINDOW;
    long.dispute_deadline = s.env.ledger().timestamp() + MAX_DISPUTE_WINDOW;
    assert_eq!(
        s.ttl_for(&long),
        ledgers(MAX_DISPUTE_WINDOW) + ORDER_TTL_BUFFER
    );

    // A short one (7 days + 14-day buffer) falls under the minimum, which applies instead.
    let short = s.order_with(OrderStatus::Disputed, 0, 3 * DAY);
    assert_eq!(s.ttl_for(&short), ORDER_MIN_TTL);
}
