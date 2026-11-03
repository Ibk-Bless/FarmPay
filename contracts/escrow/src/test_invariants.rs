#![cfg(test)]
//! Randomised testing of the escrow contract.
//!
//! The hand-written tests in `test.rs` check the cases someone thought of. This file throws
//! thousands of random sequences of actions at the contract, with the clock jumping between
//! them, and checks three things after every step:
//!
//! 1. **The spec.** A small model written from `README.md` (not from `lib.rs`) predicts what each
//!    action must do: succeed, or fail with a specific error. The contract has to agree, and an
//!    action that fails must change nothing.
//! 2. **The money.** Nothing is created or destroyed, the contract holds exactly what its open
//!    orders are owed, and every finished order has paid out exactly its amount.
//! 3. **Liveness.** At the end of each scenario every unfinished order must be closable using
//!    only the public deadline rules, without the arbiter. No money can be stuck.
//!
//! It uses a tiny seeded generator rather than a property-testing library, so there is no
//! dependency to audit and every failure is reproducible. A failing run prints its seed:
//!
//!     FARMPAY_FUZZ_SEED=1234 cargo test random_scenarios -- --nocapture
//!
//! `FARMPAY_FUZZ_CASES=5000` runs more scenarios than the default.

extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
// The contract's API takes Soroban's `String`, so the standard one is imported under another name.
use std::{format, string::String as StdString, vec::Vec};

const DAY: u64 = 24 * 60 * 60;
const START: u64 = 1_000_000;
/// What the buyer starts with: 1,000,000 USDC (7 decimals).
const FUNDS: i128 = 10_000_000_000_000;
/// Enough to run on every pull request in about half a minute. Run more with FARMPAY_FUZZ_CASES.
const DEFAULT_CASES: u64 = 60;
const STEPS: usize = 40;
const MAX_ORDERS: usize = 4;

// ---------- a tiny seeded random generator (xorshift64*) ----------

struct Rng(u64, Option<(u64, Kind)>);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1, None)
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<T: Copy>(&mut self, items: &[T]) -> T {
        items[self.below(items.len() as u64) as usize]
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
}

// ---------- the model: the spec, written independently of lib.rs ----------

#[derive(Clone, Debug)]
struct Model {
    id: u64,
    amount: i128,
    status: OrderStatus,
    delivery_deadline: u64,
    review_window: u64,
    review_deadline: u64,
    dispute_window: u64,
    dispute_deadline: u64,
    /// What this order has paid out so far.
    to_farmer: i128,
    to_buyer: i128,
}

impl Model {
    fn open(&self) -> bool {
        !matches!(
            self.status,
            OrderStatus::Released | OrderStatus::Refunded | OrderStatus::Resolved
        )
    }
}

#[derive(Clone, Copy, Debug)]
enum Kind {
    Accept,
    Cancel,
    Deliver,
    Confirm,
    Claim,
    Dispute,
    Resolve(i128),
    Expire,
}

#[derive(Clone, Copy, Debug)]
enum Step {
    Create {
        amount: i128,
        /// The buyer is also named as the farmer, which the contract must refuse.
        clash: bool,
        delivery_in: u64,
        review_window: u64,
        dispute_window: u64,
    },
    Act {
        id: u64,
        kind: Kind,
    },
    Wait(u64),
}

fn need(order: &Model, status: OrderStatus) -> Result<(), Error> {
    if order.status == status {
        Ok(())
    } else {
        Err(Error::InvalidStatus)
    }
}

/// What the spec says `kind` does to order `id` at time `now`, updating the model on success.
fn predict(orders: &mut [Model], id: u64, kind: Kind, now: u64) -> Result<(), Error> {
    let o = orders
        .iter_mut()
        .find(|o| o.id == id)
        .ok_or(Error::OrderNotFound)?;
    match kind {
        Kind::Accept => {
            need(o, OrderStatus::Funded)?;
            o.status = OrderStatus::Accepted;
        }
        Kind::Cancel => {
            match o.status {
                OrderStatus::Funded => {}
                OrderStatus::Accepted if now > o.delivery_deadline => {}
                OrderStatus::Accepted => return Err(Error::TooEarly),
                _ => return Err(Error::InvalidStatus),
            }
            o.to_buyer = o.amount;
            o.status = OrderStatus::Refunded;
        }
        Kind::Deliver => {
            need(o, OrderStatus::Accepted)?;
            o.review_deadline = now + o.review_window;
            o.status = OrderStatus::Delivered;
        }
        Kind::Confirm => {
            need(o, OrderStatus::Delivered)?;
            o.to_farmer = o.amount;
            o.status = OrderStatus::Released;
        }
        Kind::Claim => {
            need(o, OrderStatus::Delivered)?;
            if now <= o.review_deadline {
                return Err(Error::TooEarly);
            }
            o.to_farmer = o.amount;
            o.status = OrderStatus::Released;
        }
        Kind::Dispute => {
            need(o, OrderStatus::Delivered)?;
            if now > o.review_deadline {
                return Err(Error::TooLate);
            }
            o.dispute_deadline = now + o.dispute_window;
            o.status = OrderStatus::Disputed;
        }
        Kind::Resolve(farmer_share) => {
            need(o, OrderStatus::Disputed)?;
            if now > o.dispute_deadline {
                return Err(Error::TooLate);
            }
            if farmer_share < 0 || farmer_share > o.amount {
                return Err(Error::InvalidSplit);
            }
            o.to_farmer = farmer_share;
            o.to_buyer = o.amount - farmer_share;
            o.status = OrderStatus::Resolved;
        }
        Kind::Expire => {
            need(o, OrderStatus::Disputed)?;
            if now <= o.dispute_deadline {
                return Err(Error::TooEarly);
            }
            o.to_farmer = o.amount / 2;
            o.to_buyer = o.amount - o.amount / 2;
            o.status = OrderStatus::Resolved;
        }
    }
    Ok(())
}

/// The spec's rules for creating an order, checked in the order the README lists them.
fn predict_create(
    amount: i128,
    clash: bool,
    delivery_in: u64,
    review_window: u64,
    dispute_window: u64,
) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if clash {
        return Err(Error::InvalidParties);
    }
    if delivery_in == 0 || review_window == 0 {
        return Err(Error::InvalidDeadline);
    }
    if !(DAY..=30 * DAY).contains(&dispute_window) {
        return Err(Error::InvalidDeadline);
    }
    Ok(())
}

// ---------- running a scenario ----------

struct World<'a> {
    env: Env,
    client: FarmPayEscrowClient<'a>,
    token: TokenClient<'a>,
    buyer: Address,
    farmer: Address,
    arbiter: Address,
}

fn world<'a>() -> World<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);
    let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let buyer = Address::generate(&env);
    StellarAssetClient::new(&env, &usdc.address()).mint(&buyer, &FUNDS);
    let contract = env.register(FarmPayEscrow, (usdc.address(),));
    World {
        client: FarmPayEscrowClient::new(&env, &contract),
        token: TokenClient::new(&env, &usdc.address()),
        farmer: Address::generate(&env),
        arbiter: Address::generate(&env),
        buyer,
        env,
    }
}

/// A contract error is an answer; anything else (a host failure) means the test itself is wrong.
/// (`C` is the client's conversion error, whose type differs between methods.)
fn answer<T: core::fmt::Debug, C: core::fmt::Debug>(
    call: Result<Result<T, C>, Result<Error, soroban_sdk::InvokeError>>,
) -> Result<T, Error> {
    match call {
        Ok(Ok(value)) => Ok(value),
        Err(Ok(error)) => Err(error),
        other => panic!("the call failed in an unexpected way: {other:?}"),
    }
}

fn run(w: &World, id: u64, kind: Kind) -> Result<(), Error> {
    let c = &w.client;
    match kind {
        Kind::Accept => answer(c.try_accept_order(&id)),
        Kind::Cancel => answer(c.try_cancel_order(&id)),
        Kind::Deliver => answer(c.try_mark_delivered(&id)),
        Kind::Confirm => answer(c.try_confirm_delivery(&id)),
        Kind::Claim => answer(c.try_claim_payment(&id)),
        Kind::Dispute => answer(c.try_open_dispute(&id, &String::from_str(&w.env, "complaint"))),
        Kind::Resolve(share) => answer(c.try_resolve_dispute(&id, &share)),
        Kind::Expire => answer(c.try_expire_dispute(&id)),
    }
}

fn fail(what: StdString, context: &dyn Fn() -> StdString) -> ! {
    panic!("{what}\n{}", context())
}

/// What `check_invariants` re-reads from the chain. Reading everything after every step makes a
/// scenario slow, so each step checks the balances and the one order it touched, and the end of
/// the scenario checks everything.
#[derive(Clone, Copy)]
enum Scope {
    Touched(Option<u64>),
    All,
}

fn check_invariants(w: &World, orders: &[Model], scope: Scope, context: &dyn Fn() -> StdString) {
    let spent: i128 = orders.iter().map(|o| o.amount).sum();
    let refunded: i128 = orders.iter().map(|o| o.to_buyer).sum();
    let paid: i128 = orders.iter().map(|o| o.to_farmer).sum();
    let held: i128 = orders.iter().filter(|o| o.open()).map(|o| o.amount).sum();
    let buyer = w.token.balance(&w.buyer);
    let farmer = w.token.balance(&w.farmer);
    let contract = w.token.balance(&w.client.address);
    // The arbiter never receives anything in these scenarios; that is checked at the end.
    let arbiter = if matches!(scope, Scope::All) {
        w.token.balance(&w.arbiter)
    } else {
        0
    };

    if contract != held {
        fail(
            format!("the contract holds {contract} but its open orders are owed {held}"),
            context,
        );
    }
    if buyer + farmer + arbiter + contract != FUNDS {
        fail(
            format!(
                "money was created or destroyed: {} in total, expected {FUNDS}",
                buyer + farmer + arbiter + contract
            ),
            context,
        );
    }
    if (buyer, farmer, arbiter) != (FUNDS - spent + refunded, paid, 0) {
        fail(
            format!(
                "balances {buyer}/{farmer}/{arbiter} do not match the model {}/{paid}/0",
                FUNDS - spent + refunded
            ),
            context,
        );
    }

    for o in orders {
        // Money paid out is pure model arithmetic, so it is checked for every order every step...
        let payout = o.to_farmer + o.to_buyer;
        let expected = if o.open() { 0 } else { o.amount };
        if payout != expected {
            fail(
                format!(
                    "order {} paid out {payout}, expected {expected} ({:?})",
                    o.id, o.status
                ),
                context,
            );
        }
        // ...but the contract is only asked about the orders in scope.
        let in_scope = match scope {
            Scope::All => true,
            Scope::Touched(id) => id == Some(o.id),
        };
        if !in_scope {
            continue;
        }
        let actual = w.client.get_order(&o.id);
        let same = actual.status == o.status
            && actual.amount == o.amount
            && actual.review_deadline == o.review_deadline
            && actual.dispute_deadline == o.dispute_deadline
            && actual.delivery_deadline == o.delivery_deadline
            && actual.review_window == o.review_window
            && actual.dispute_window == o.dispute_window;
        if !same {
            fail(
                format!(
                    "order {} differs from the spec: contract {actual:?}, model {o:?}",
                    o.id
                ),
                context,
            );
        }
    }
}

// ---------- choosing what happens next ----------

fn logical_next(rng: &mut Rng, order: &Model) -> Kind {
    match order.status {
        OrderStatus::Funded => Kind::Accept,
        OrderStatus::Accepted => Kind::Deliver,
        OrderStatus::Delivered => rng.pick(&[Kind::Confirm, Kind::Claim, Kind::Dispute]),
        OrderStatus::Disputed => resolve_or_expire(rng, order.amount),
        _ => random_kind(rng, order.amount),
    }
}

fn resolve_or_expire(rng: &mut Rng, amount: i128) -> Kind {
    if rng.chance(50) {
        Kind::Expire
    } else {
        let share = match rng.below(6) {
            0 => 0,
            1 => amount,
            2 => amount / 2,
            3 => amount + 1, // more than the order: must be refused
            4 => -1,         // negative: must be refused
            _ => (rng.next() as i128).rem_euclid(amount + 1),
        };
        Kind::Resolve(share)
    }
}

fn random_kind(rng: &mut Rng, amount: i128) -> Kind {
    match rng.below(8) {
        0 => Kind::Accept,
        1 => Kind::Cancel,
        2 => Kind::Deliver,
        3 => Kind::Confirm,
        4 => Kind::Claim,
        5 => Kind::Dispute,
        _ => resolve_or_expire(rng, amount),
    }
}

fn next_step(rng: &mut Rng, orders: &[Model], buyer_balance: i128, now: u64) -> Step {
    // Mistakes in deadline checks hide at the exact second, so often wait until one second
    // before, exactly at, or one second after a deadline of an order that is still open.
    // The action planned for right after such a wait, so the boundary itself gets exercised.
    if let Some((id, kind)) = rng.1.take() {
        return Step::Act { id, kind };
    }
    if rng.chance(12) {
        let targets: Vec<(&Model, u64)> = orders
            .iter()
            .filter(|o| o.open())
            .flat_map(|o| {
                [o.delivery_deadline, o.review_deadline, o.dispute_deadline].map(|d| (o, d))
            })
            .filter(|(_, d)| *d > now)
            .collect();
        if !targets.is_empty() {
            let (order, deadline) = rng.pick(&targets);
            let wait = (deadline - now) as i64 + rng.pick(&[-1i64, 0, 0, 1]);
            let kind = if rng.chance(50) {
                logical_next(rng, order)
            } else {
                random_kind(rng, order.amount)
            };
            rng.1 = Some((order.id, kind));
            return Step::Wait(wait.max(1) as u64);
        }
    }
    if rng.chance(25) {
        return Step::Wait(rng.pick(&[1, 60, 3_600, DAY, 3 * DAY + 1, 7 * DAY + 1, 31 * DAY]));
    }
    if orders.len() < MAX_ORDERS && (orders.is_empty() || rng.chance(15)) {
        let cap = (buyer_balance / 4).max(1);
        let amount = match rng.below(10) {
            0 => 0,
            1 => -1,
            2 => 1,
            3 => 3,
            4 => 10_000_001, // odd, so the even split has a remainder
            _ => 1 + (rng.next() as i128).rem_euclid(cap),
        }
        .min(buyer_balance);
        return Step::Create {
            amount,
            clash: rng.chance(5),
            delivery_in: rng.pick(&[0, 3_600, DAY, 7 * DAY, 7 * DAY]),
            review_window: rng.pick(&[0, 3_600, DAY, 3 * DAY, 3 * DAY]),
            dispute_window: rng.pick(&[DAY, 7 * DAY, 7 * DAY, 30 * DAY, 0, DAY - 1, 30 * DAY + 1]),
        };
    }
    let id = if orders.is_empty() || rng.chance(5) {
        orders.len() as u64 + 7 // an order that does not exist
    } else {
        rng.pick(&orders.iter().map(|o| o.id).collect::<Vec<_>>())
    };
    let kind = match orders.iter().find(|o| o.id == id) {
        Some(order) if rng.chance(65) => logical_next(rng, order),
        Some(order) => random_kind(rng, order.amount),
        None => random_kind(rng, 100),
    };
    Step::Act { id, kind }
}

// ---------- one scenario ----------

fn run_scenario(seed: u64) {
    let mut rng = Rng::new(seed);
    let w = world();
    let mut model: Vec<Model> = Vec::new();
    let mut now = START;
    let mut trace: Vec<StdString> = Vec::new();

    macro_rules! context {
        () => {
            &|| {
                format!(
                    "scenario seed {seed}; steps so far:\n  {}",
                    trace.join("\n  ")
                )
            }
        };
    }

    for n in 0..STEPS {
        let buyer_balance = w.token.balance(&w.buyer);
        let step = next_step(&mut rng, &model, buyer_balance, now);
        trace.push(format!("{n}: t={} {step:?}", now - START));

        match step {
            Step::Wait(seconds) => {
                now += seconds;
                w.env.ledger().set_timestamp(now);
            }
            Step::Create {
                amount,
                clash,
                delivery_in,
                review_window,
                dispute_window,
            } => {
                let expected =
                    predict_create(amount, clash, delivery_in, review_window, dispute_window);
                let got = answer(w.client.try_create_order(
                    &w.buyer,
                    if clash { &w.buyer } else { &w.farmer },
                    &w.arbiter,
                    &amount,
                    &(now + delivery_in),
                    &review_window,
                    &dispute_window,
                ));
                match (&expected, &got) {
                    (Ok(()), Ok(id)) => model.push(Model {
                        id: *id,
                        amount,
                        status: OrderStatus::Funded,
                        delivery_deadline: now + delivery_in,
                        review_window,
                        review_deadline: 0,
                        dispute_window,
                        dispute_deadline: 0,
                        to_farmer: 0,
                        to_buyer: 0,
                    }),
                    (Err(want), Err(have)) if want == have => {}
                    _ => panic!("create_order: the spec says {expected:?}, the contract answered {got:?}\n{}", context!()()),
                }
                if let Ok(id) = got {
                    let expected_id = model.len() as u64;
                    if id != expected_id {
                        panic!("order ids must be sequential from 1: got {id}, expected {expected_id}\n{}", context!()());
                    }
                }
            }
            Step::Act { id, kind } => {
                let expected = predict(&mut model, id, kind, now);
                let got = run(&w, id, kind);
                if expected != got {
                    panic!("{kind:?} on order {id}: the spec says {expected:?}, the contract answered {got:?}\n{}", context!()());
                }
            }
        }
        let touched = match step {
            Step::Act { id, .. } => Some(id),
            Step::Create { .. } => model.last().map(|o| o.id),
            Step::Wait(_) => None,
        };
        check_invariants(&w, &model, Scope::Touched(touched), context!());
    }

    // Liveness: every unfinished order can be closed using only the public deadline rules.
    // The arbiter never acts here, so a missing arbiter cannot leave money stuck.
    for pass in 0..4 {
        for i in 0..model.len() {
            let (id, status, delivery_deadline, review_deadline, dispute_deadline) = {
                let o = &model[i];
                (
                    o.id,
                    o.status,
                    o.delivery_deadline,
                    o.review_deadline,
                    o.dispute_deadline,
                )
            };
            let (kind, ready_at) = match status {
                OrderStatus::Funded => (Kind::Cancel, now),
                OrderStatus::Accepted => (Kind::Cancel, delivery_deadline + 1),
                OrderStatus::Delivered => (Kind::Claim, review_deadline + 1),
                OrderStatus::Disputed => (Kind::Expire, dispute_deadline + 1),
                _ => continue,
            };
            now = now.max(ready_at);
            w.env.ledger().set_timestamp(now);
            trace.push(format!(
                "drain {pass}: t={} {kind:?} on order {id}",
                now - START
            ));
            let expected = predict(&mut model, id, kind, now);
            let got = run(&w, id, kind);
            if expected != Ok(()) || got != Ok(()) {
                panic!("order {id} ({status:?}) could not be closed by the public rules: spec {expected:?}, contract {got:?}\n{}", context!()());
            }
        }
    }
    check_invariants(&w, &model, Scope::All, context!());
    if let Some(stuck) = model.iter().find(|o| o.open()) {
        panic!(
            "order {} is still open after the drain: {stuck:?}\n{}",
            stuck.id,
            context!()()
        );
    }
    if w.token.balance(&w.client.address) != 0 {
        panic!(
            "the contract still holds money after every order finished\n{}",
            context!()()
        );
    }
}

#[test]
fn random_scenarios_match_the_spec_and_never_lose_or_lock_money() {
    if let Ok(seed) = std::env::var("FARMPAY_FUZZ_SEED") {
        return run_scenario(seed.parse().expect("FARMPAY_FUZZ_SEED must be a number"));
    }
    let cases = std::env::var("FARMPAY_FUZZ_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_CASES);
    for seed in 1..=cases {
        run_scenario(seed);
    }
}

#[test]
fn the_generator_reaches_every_state_and_every_error() {
    // A test of the test. If the random scenarios never reached disputes, expiries or late
    // cancellations, passing them would prove little, so count what they actually cover. This
    // only needs the model (the contract answers identically in the main test), so it is instant.
    let mut statuses = std::collections::BTreeSet::new();
    let mut errors = std::collections::BTreeSet::new();
    let mut resolved_by_expiry = false;
    let mut resolved_by_ruling = false;
    let mut cancelled_late = false;

    for seed in 1..=DEFAULT_CASES {
        let mut rng = Rng::new(seed);
        let mut model: Vec<Model> = Vec::new();
        let mut now = START;
        for _ in 0..STEPS {
            let spent: i128 = model.iter().map(|o| o.amount).sum();
            let refunded: i128 = model.iter().map(|o| o.to_buyer).sum();
            match next_step(&mut rng, &model, FUNDS - spent + refunded, now) {
                Step::Wait(seconds) => now += seconds,
                Step::Create {
                    amount,
                    clash,
                    delivery_in,
                    review_window,
                    dispute_window,
                } => {
                    match predict_create(amount, clash, delivery_in, review_window, dispute_window)
                    {
                        Err(e) => {
                            errors.insert(e as u32);
                        }
                        Ok(()) => model.push(Model {
                            id: model.len() as u64 + 1,
                            amount,
                            status: OrderStatus::Funded,
                            delivery_deadline: now + delivery_in,
                            review_window,
                            review_deadline: 0,
                            dispute_window,
                            dispute_deadline: 0,
                            to_farmer: 0,
                            to_buyer: 0,
                        }),
                    }
                }
                Step::Act { id, kind } => {
                    let was = model.iter().find(|o| o.id == id).map(|o| o.status);
                    match predict(&mut model, id, kind, now) {
                        Err(e) => {
                            errors.insert(e as u32);
                        }
                        Ok(()) => match (kind, was) {
                            (Kind::Expire, _) => resolved_by_expiry = true,
                            (Kind::Resolve(_), _) => resolved_by_ruling = true,
                            (Kind::Cancel, Some(OrderStatus::Accepted)) => cancelled_late = true,
                            _ => {}
                        },
                    }
                }
            }
            for o in &model {
                statuses.insert(o.status as u32);
            }
        }
    }

    // OrderStatus has 7 states and Error has 8 codes.
    assert_eq!(
        statuses.len(),
        7,
        "some order states were never reached: {statuses:?}"
    );
    assert_eq!(
        errors.len(),
        8,
        "some errors were never provoked: {errors:?}"
    );
    assert!(resolved_by_expiry, "no dispute was ever settled by default");
    assert!(
        resolved_by_ruling,
        "no dispute was ever ruled on by the arbiter"
    );
    assert!(
        cancelled_late,
        "no accepted order was ever cancelled after its deadline"
    );
}
