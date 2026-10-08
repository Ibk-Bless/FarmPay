#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};

const AMOUNT: i128 = 10_000_000_000; // 1,000 USDC (7 decimals)
const DELIVERY_DEADLINE: u64 = 10_000;
const REVIEW_WINDOW: u64 = 3 * 24 * 60 * 60;

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
        s.client
            .try_create_order(buyer, farmer, &s.arbiter, &amount, &deadline, &window)
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
