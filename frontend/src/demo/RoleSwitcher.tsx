import { ROLE_LABELS, type DemoRole } from './accounts'
import { useDemo } from './context'

const ROLES: DemoRole[] = ['buyer', 'farmer', 'cooperative', 'visitor']

/** Stands in for the wallet button in the demo: choose who you are acting as. */
export default function RoleSwitcher() {
  const { role, setRole } = useDemo()
  return (
    <div className="flex items-center gap-2">
      {/* The label is hidden on narrow screens to keep the header on one line; it stays for screen readers. */}
      <label htmlFor="demo-role" className="sr-only sm:not-sr-only text-sm text-gray-700">
        View as
      </label>
      <select
        id="demo-role"
        value={role}
        onChange={(e) => setRole(e.target.value as DemoRole)}
        className="w-36 sm:w-auto border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </div>
  )
}
