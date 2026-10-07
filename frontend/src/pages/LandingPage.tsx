import { ArrowRight, Shield, Zap, Globe, TrendingUp, CheckCircle, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <span className="text-3xl">🌾</span>
              <span className="text-2xl font-bold text-green-700">FarmPay</span>
            </div>
            <div className="hidden md:flex space-x-8">
              <a href="#problem" className="text-gray-700 hover:text-green-600">The Problem</a>
              <a href="#solution" className="text-gray-700 hover:text-green-600">Solution</a>
              <a href="#how-it-works" className="text-gray-700 hover:text-green-600">How It Works</a>
              <a href="#features" className="text-gray-700 hover:text-green-600">Features</a>
            </div>
            <div className="flex space-x-4">
              <Link to="/farmer/dashboard" className="text-green-600 hover:text-green-700 font-medium">
                Farmer Login
              </Link>
              <Link to="/buyer/dashboard" className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition">
                Buyer Login
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 text-balance">
            Guaranteed payment for farm deliveries on <span className="text-green-600">Stellar</span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 mb-8 max-w-3xl mx-auto text-balance">
            The buyer's USDC is locked in escrow before the farmer delivers — and released on confirmation, or automatically if the buyer goes quiet.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/order/create" className="bg-green-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-700 transition flex items-center justify-center">
              Create Purchase Order
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
            <a href="#how-it-works" className="border-2 border-green-600 text-green-600 px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-50 transition">
              See How It Works
            </a>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-20">
          <div className="text-center">
            <div className="text-4xl font-bold text-green-600">100%</div>
            <div className="text-gray-600 mt-2">Of every order pre-funded before delivery</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-green-600">72 hours</div>
            <div className="text-gray-600 mt-2">Example review window before auto-release</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-green-600">0</div>
            <div className="text-gray-600 mt-2">Funds held by FarmPay — the contract holds them</div>
          </div>
        </div>
      </section>

      {/* The Problem Section */}
      <section id="problem" className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">The Problem</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Farming is one of the few businesses where you do all the work first and get paid last.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="space-y-6">
                <div className="flex items-start space-x-4">
                  <Clock className="h-8 w-8 text-red-500 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">30-90 Day Payment Terms</h3>
                    <p className="text-gray-600">
                      Farmers deliver their harvest but wait months for payment. The buyer inspects, accepts, and issues a payment term — not a payment.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <TrendingUp className="h-8 w-8 text-red-500 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">Forced to Borrow</h3>
                    <p className="text-gray-600">
                      Meanwhile, laborers need payment, inputs must be purchased, transport costs are due. Farmers borrow at punishing rates just to survive the wait.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-4">
                  <Shield className="h-8 w-8 text-red-500 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">No Leverage After Delivery</h3>
                    <p className="text-gray-600">
                      Once the produce leaves their hands, farmers have no power. Payment depends entirely on the buyer's goodwill and cash flow.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 p-8 rounded-xl border-2 border-gray-200">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">A Typical Farmer's Timeline</h4>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-gray-700"><strong>March:</strong> Plant maize</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-gray-700"><strong>August:</strong> Harvest and deliver</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <span className="text-gray-700"><strong>August:</strong> Buyer says "30 days"</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <span className="text-gray-700"><strong>August:</strong> Borrow to pay workers</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <span className="text-gray-700"><strong>September:</strong> Still waiting...</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-gray-700"><strong>October:</strong> Finally paid (minus interest)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Solution Section */}
      <section id="solution" className="py-20 bg-gradient-to-b from-green-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">The Solution</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              FarmPay puts a Stellar-powered escrow between every farm delivery and buyer payment.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
            <div className="order-2 md:order-1">
              <div className="bg-white p-8 rounded-xl shadow-lg border border-green-100">
                <h4 className="text-lg font-semibold text-gray-900 mb-4">FarmPay Timeline</h4>
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <span className="text-gray-700"><strong>Day 1:</strong> Buyer creates order, locks payment in escrow</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <span className="text-gray-700"><strong>Day 1:</strong> Farmer sees secured funds, accepts order</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <span className="text-gray-700"><strong>Delivery day:</strong> Farmer delivers and marks the order delivered</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <span className="text-gray-700"><strong>Within the review window:</strong> Buyer confirms — or stays silent — and the farmer is paid</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <span className="text-gray-700"><strong>If there's a problem:</strong> The cooperative decides a fair split</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 md:order-2">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Payment isn't a promise — it's a guarantee</h3>
              <div className="space-y-4">
                <p className="text-gray-700">
                  The buyer locks payment in a Stellar escrow when creating the order. The farmer sees the funds are secured before accepting. After delivery, the buyer has a fixed review window to confirm or dispute — if they do nothing, the farmer can claim the payment.
                </p>
                <p className="text-gray-700">
                  Neither party can take the money back on their own. Disputes go to an arbiter both sides agreed to up front — the farmer's cooperative.
                </p>
                <p className="text-gray-700 font-semibold text-green-700">
                  The farmer delivers knowing they will be paid. The buyer pays knowing they will receive.
                </p>
              </div>
            </div>
          </div>

          {/* Why Stellar */}
          <div className="bg-white rounded-xl shadow-lg p-8 md:p-12">
            <h3 className="text-3xl font-bold text-gray-900 mb-8 text-center">Why Stellar</h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="text-center">
                <Shield className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Real Escrow</h4>
                <p className="text-gray-600">
                  A Soroban contract enforces the rules. FarmPay never holds the funds and cannot move them.
                </p>
              </div>
              <div className="text-center">
                <Zap className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Fast Settlement</h4>
                <p className="text-gray-600">
                  Once the escrow releases, the USDC lands in the farmer's wallet within seconds.
                </p>
              </div>
              <div className="text-center">
                <Globe className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Stable USDC</h4>
                <p className="text-gray-600">
                  Farmers are paid in a dollar-backed stablecoin, not a volatile token. Local cash-out via Stellar anchors is on the roadmap.
                </p>
              </div>
              <div className="text-center">
                <TrendingUp className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Near-Zero Fees</h4>
                <p className="text-gray-600">
                  Fractions of a cent per transaction make small orders viable. A $50 vegetable delivery is as protected as a $50,000 grain order.
                </p>
              </div>
              <div className="text-center">
                <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Permanent Records</h4>
                <p className="text-gray-600">
                  On-chain delivery history farmers own. Can't be deleted, travels with them to every new buyer relationship.
                </p>
              </div>
              <div className="text-center">
                <Shield className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h4 className="text-xl font-semibold text-gray-900 mb-2">Fair Disputes</h4>
                <p className="text-gray-600">
                  A named arbiter can split the funds between farmer and buyer — no more payments stuck forever over a disagreement.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">How It Works</h2>
            <p className="text-xl text-gray-600">Simple, transparent, enforced by code</p>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="space-y-8">
              {[
                { step: 1, title: 'Buyer Creates Order and Locks USDC', desc: 'Names the farmer, the cooperative as arbiter, the amount, and a delivery deadline' },
                { step: 2, title: 'Farmer Sees Locked Funds → Accepts', desc: 'Until then, the buyer can cancel for a full refund' },
                { step: 3, title: 'Farmer Delivers and Marks the Order Delivered', desc: 'This starts the review window (e.g. 72 hours)' },
                { step: 4, title: 'Buyer Confirms → Farmer Is Paid', desc: 'If the buyer does nothing before the window closes, the farmer can claim the payment' },
                { step: 5, title: 'Or: Buyer Opens a Dispute', desc: 'The cooperative decides how the funds are split between farmer and buyer' },
                { step: 6, title: 'Outcome Recorded On-Chain', desc: "Each completed order adds to the farmer's verifiable delivery history" },
              ].map((item, idx) => (
                <div key={idx} className="flex items-start space-x-6">
                  <div className="flex-shrink-0 w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center text-xl font-bold">
                    {item.step}
                  </div>
                  <div className="flex-1 pt-2">
                    <h3 className="text-xl font-semibold text-gray-900 mb-1">{item.title}</h3>
                    <p className="text-gray-600">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Delivery Profile Section */}
      <section className="py-20 bg-gradient-to-b from-green-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">The Delivery History Farmers Actually Own</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Every completed order builds an on-chain delivery profile that the farmer can show to new buyers.
            </p>
          </div>

          <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-lg p-8 border-2 border-green-100">
            <div className="border-b-2 border-gray-200 pb-4 mb-6">
              <h3 className="text-2xl font-bold text-gray-900">Farmer: Amara Diallo</h3>
              <p className="text-gray-600">Verified on Stellar · 2 completed orders · 100% on-time delivery</p>
            </div>
            
            <div className="space-y-6">
              <div className="border-l-4 border-green-500 pl-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold text-gray-900">Cashew — 2,000kg</h4>
                    <p className="text-sm text-gray-600">West Africa Exports Ltd</p>
                  </div>
                  <CheckCircle className="h-6 w-6 text-green-500" />
                </div>
                <p className="text-sm text-gray-600">Delivery: March 2025</p>
                <p className="text-sm font-semibold text-green-700">Payment: $1,840 USDC — released on buyer confirmation</p>
              </div>

              <div className="border-l-4 border-green-500 pl-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold text-gray-900">Maize — 5,000kg</h4>
                    <p className="text-sm text-gray-600">NutriFood Processing Co.</p>
                  </div>
                  <CheckCircle className="h-6 w-6 text-green-500" />
                </div>
                <p className="text-sm text-gray-600">Delivery: August 2025</p>
                <p className="text-sm font-semibold text-green-700">Payment: $2,100 USDC — released after review window</p>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <p className="text-gray-700 text-center">
                <strong>This profile is shareable.</strong> Show it to new buyers or your cooperative — it's an on-chain record nobody can alter.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Core Features</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { title: 'Purchase Order Creation', desc: 'Buyers create orders with crop details, quantity, price, and delivery deadline' },
              { title: 'Escrow Locking', desc: 'USDC locked in a Soroban escrow at order creation — visible to the farmer before acceptance' },
              { title: 'Order Acceptance', desc: 'Farmers accept orders knowing funds are already secured' },
              { title: 'Delivery Confirmation', desc: 'Buyer confirms receipt and the escrow pays the farmer' },
              { title: 'Review Window & Auto-Release', desc: 'If the buyer stays silent, the farmer can claim payment once the window closes' },
              { title: 'Farmer Delivery Profile', desc: 'Public, shareable record of completed deliveries and payments' },
              { title: 'Buyer Dashboard', desc: 'Track all active and completed purchase orders' },
              { title: 'Farmer Dashboard', desc: 'Active orders, payment history, and delivery profile link' },
              { title: 'Cooperative Arbitration', desc: 'Disputes are settled by the farmer\'s cooperative with a fair split' },
            ].map((feature, idx) => (
              <div key={idx} className="bg-green-50 p-6 rounded-lg border border-green-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Target Users */}
      <section className="py-20 bg-gradient-to-b from-green-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Who FarmPay Serves</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-5xl mb-4">👨‍🌾</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Smallholder Farmers</h3>
              <p className="text-gray-600">Selling through a cooperative to aggregators, processors, or exporters</p>
            </div>
            <div className="text-center">
              <div className="text-5xl mb-4">🏢</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Agricultural Buyers</h3>
              <p className="text-gray-600">Who already pay on delivery and want a verifiable, dispute-safe way to do it</p>
            </div>
            <div className="text-center">
              <div className="text-5xl mb-4">🤝</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Cooperatives</h3>
              <p className="text-gray-600">Onboard their members and act as the trusted arbiter for disputes</p>
            </div>
            <div className="text-center">
              <div className="text-5xl mb-4">🏦</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Input Lenders (Future)</h3>
              <p className="text-gray-600">Verified delivery histories could support input loans — a research item on our roadmap</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-green-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Deliver against money, not promises.
          </h2>
          <p className="text-xl text-green-100 mb-8">
            FarmPay is in development on Stellar testnet. Try the flow and help us build it.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/order/create" className="bg-white text-green-600 px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-50 transition">
              Create Your First Order
            </Link>
            <Link to="/farmer/dashboard" className="border-2 border-white text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-green-700 transition">
              View Farmer Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <span className="text-3xl">🌾</span>
                <span className="text-2xl font-bold text-white">FarmPay</span>
              </div>
              <p className="text-gray-400">
                Guaranteed payment for farm deliveries on Stellar.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2">
                <li><a href="#features" className="hover:text-white">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-white">How It Works</a></li>
                <li><Link to="/order/create" className="hover:text-white">Create Order</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Resources</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-white">Documentation</a></li>
                <li><a href="#" className="hover:text-white">API Reference</a></li>
                <li><a href="#" className="hover:text-white">Support</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-white">About</a></li>
                <li><a href="#" className="hover:text-white">Blog</a></li>
                <li><a href="#" className="hover:text-white">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2026 FarmPay. Built on Stellar. Empowering farmers worldwide.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
