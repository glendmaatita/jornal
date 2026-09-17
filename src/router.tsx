/* eslint-disable react-refresh/only-export-components -- router config module, not a component file */
import { lazy } from "react"
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"


const HomePage = lazy(() => import("@/pages/home-page").then((m) => ({ default: m.HomePage })))
const AccountsPage = lazy(() => import("@/pages/accounts-page").then((m) => ({ default: m.AccountsPage })))
const AppShell = lazy(() => import("@/components/app-shell").then((m) => ({ default: m.AppShell })))
const LoginPage = lazy(() => import("@/pages/login-page").then((m) => ({ default: m.LoginPage })))
const OnboardingPage = lazy(() => import("@/pages/onboarding-page").then((m) => ({ default: m.OnboardingPage })))
const InsightsPage = lazy(() => import("@/pages/insights-page").then((m) => ({ default: m.InsightsPage })))
const SafeToSpendPage = lazy(() => import("@/pages/safe-to-spend-page").then((m) => ({ default: m.SafeToSpendPage })))
const ForecastPage = lazy(() => import("@/pages/forecast-page").then((m) => ({ default: m.ForecastPage })))
const SettingsPage = lazy(() => import("@/pages/settings-page").then((m) => ({ default: m.SettingsPage })))
const TaxPage = lazy(() => import("@/pages/tax-page").then((m) => ({ default: m.TaxPage })))
const TransactionDetailPage = lazy(() =>
  import("@/pages/transaction-detail-page").then((m) => ({ default: m.TransactionDetailPage })),
)
const TransactionFormPage = lazy(() =>
  import("@/pages/transaction-form-page").then((m) => ({ default: m.TransactionFormPage })),
)
const TransactionsPage = lazy(() => import("@/pages/transactions-page").then((m) => ({ default: m.TransactionsPage })))
const ReceivablesPage = lazy(() => import("@/pages/receivables-page").then((m) => ({ default: m.ReceivablesPage })))
const CompaniesPage = lazy(() => import("@/pages/companies-page").then((m) => ({ default: m.CompaniesPage })))
const CustomersPage = lazy(() => import("@/pages/customers-page").then((m) => ({ default: m.CustomersPage })))
const CustomerFormPage = lazy(() => import("@/pages/customer-form-page").then((m) => ({ default: m.CustomerFormPage })))
const CustomerDetailPage = lazy(() => import("@/pages/customer-detail-page").then((m) => ({ default: m.CustomerDetailPage })))
const InvoicesPage = lazy(() => import("@/pages/invoices-page").then((m) => ({ default: m.InvoicesPage })))
const InvoiceFormPage = lazy(() => import("@/pages/invoice-form-page").then((m) => ({ default: m.InvoiceFormPage })))
const InvoiceDetailPage = lazy(() => import("@/pages/invoice-detail-page").then((m) => ({ default: m.InvoiceDetailPage })))
const InvoiceSettingsPage = lazy(() => import("@/pages/invoice-settings-page").then((m) => ({ default: m.InvoiceSettingsPage })))
const DocumentInboxPage = lazy(() => import("@/pages/document-inbox-page").then((m) => ({ default: m.DocumentInboxPage })))
const DocumentReviewPage = lazy(() => import("@/pages/document-review-page").then((m) => ({ default: m.DocumentReviewPage })))
const SyncCenterPage = lazy(() => import("@/pages/sync-center-page").then((m) => ({ default: m.SyncCenterPage })))
const SearchPage = lazy(() => import("@/pages/search-page").then((m) => ({ default: m.SearchPage })))
const TransactionTemplatesPage = lazy(() => import("@/pages/transaction-templates-page").then((m) => ({ default: m.TransactionTemplatesPage })))

function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-5 text-center">
      <div className="max-w-sm">
        <h1 className="text-2xl tracking-tight">Halaman tidak ditemukan</h1>
        <p className="mt-2 text-sm text-[var(--body-text)]">Tautan ini sudah berubah atau belum tersedia.</p>
        <a href="/" className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Ke beranda</a>
      </div>
    </main>
  )
}

function BackendUnavailablePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-5 text-center">
      <div className="max-w-sm">
        <h1 className="text-2xl tracking-tight">Data belum bisa dimuat</h1>
        <p className="mt-2 text-sm text-[var(--body-text)]">Periksa koneksi ke server, lalu coba lagi. Data di perangkat tetap aman.</p>
        <button type="button" className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground" onClick={() => window.location.reload()}>
          Coba lagi
        </button>
      </div>
    </main>
  )
}

const rootRoute = createRootRoute({ notFoundComponent: NotFoundPage })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
})

const unavailableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/data-unavailable",
  component: BackendUnavailablePage,
})

// Pathless authenticated layout: everything below requires a logged-in tenant.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AppShell,
  beforeLoad: async ({ location }) => {
    // Keep the public login entry lightweight. The auth, local-store, and
    // sync graph is only needed after a protected route is actually matched.
    const [{ pb, pocketBaseConfigured }, store, sync, companyStore] = await Promise.all([
      import("@/lib/pb"),
      import("@/lib/store"),
      import("@/lib/pocketbase-sync"),
      import("@/lib/companies"),
    ])
    if (!pb.authStore.isValid) {
      try {
        if (location.href && location.pathname !== "/login") {
          window.sessionStorage.setItem("jornal.pending-route", location.href)
        }
      } catch { /* private browsing can disable session storage */ }
      throw redirect({ to: "/login", replace: true })
    }
    const tenantId = pb.authStore.record?.id ?? "local"
    store.setTenantScope(tenantId)
    let companies
    try {
      companies = await companyStore.loadCompanies()
    } catch {
      throw redirect({ to: "/data-unavailable", replace: true })
    }
    const companyIndependent = location.pathname === "/onboarding"
      || location.pathname === "/companies"
      || location.pathname === "/companies/new"
      || /^\/companies\/[^/]+\/setup$/.test(location.pathname)
    if (companies.length === 0) {
      store.setCompanyScope(tenantId)
      if (!companyIndependent) {
        try { if (location.href) window.sessionStorage.setItem("jornal.pending-route", location.href) } catch { /* ignore */ }
        throw redirect({ to: "/onboarding", replace: true })
      }
      return
    }
    const explicitId = new URL(location.href, window.location.origin).searchParams.get("company")
    const selected = (explicitId ? companies.find((company) => company.id === explicitId) : null)
      ?? companies.find((company) => company.id === companyStore.selectedCompanyId())
      ?? companies.find((company) => company.status === "ACTIVE")
      ?? companies[0]
    if (explicitId && !companies.some((company) => company.id === explicitId)) {
      throw redirect({ to: "/companies", replace: true })
    }
    companyStore.selectCompany(selected.id)
    store.setCompanyScope(selected.id, selected.dataEpoch)
    store.setCompanyWritable(selected.status === "ACTIVE")
    store.setCompanyLegacyDefault(selected.legacyDefault)
    store.setCompanyDisplayName(selected.name)
    await companyStore.migrateLegacyCompanyData(selected)
    if (companyIndependent) return
    if (selected.status === "ARCHIVED" && (location.pathname === "/add" || /\/edit$/.test(location.pathname))) {
      throw redirect({ to: "/companies", replace: true })
    }
    await sync.initializePocketBaseSync()
    if (pocketBaseConfigured && sync.getHydrationState() === "unavailable") {
      throw redirect({ to: "/data-unavailable", replace: true })
    }
    if (!selected.onboardingCompletedAt) {
      throw redirect({ to: "/companies/$companyId/setup", params: { companyId: selected.id }, replace: true })
    }
  },
})

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: HomePage,
})

const onboardingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/onboarding",
  component: OnboardingPage,
})

const companiesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/companies",
  component: CompaniesPage,
})

const newCompanyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/companies/new",
  component: OnboardingPage,
})

const companySetupRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/companies/$companyId/setup",
  component: OnboardingPage,
})

const addRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/add",
  component: TransactionFormPage,
})

const accountsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/accounts",
  component: AccountsPage,
  validateSearch: (search: Record<string, unknown>): { account?: string } => ({
    account: typeof search.account === "string" ? search.account : undefined,
  }),
})

const transactionsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/transactions",
  component: TransactionsPage,
  validateSearch: (search: Record<string, unknown>): { filter?: string } => ({
    filter: typeof search.filter === "string" ? search.filter : undefined,
  }),
})

const receivablesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/receivables",
  component: ReceivablesPage,
})

const transactionDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/transactions/$transactionId",
  component: function TransactionDetailRoute() {
    const { transactionId } = transactionDetailRoute.useParams()
    return <TransactionDetailPage transactionId={transactionId} />
  },
})

const transactionEditRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/transactions/$transactionId/edit",
  component: TransactionFormPage,
})

const taxRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/tax",
  component: TaxPage,
})

const insightsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/insights",
  component: InsightsPage,
})

const safeToSpendRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/safe-to-spend",
  component: SafeToSpendPage,
})

const forecastRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/forecast",
  component: ForecastPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/settings",
  component: SettingsPage,
})

const customersRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/customers", component: CustomersPage })
const customerNewRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/customers/new", validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({ returnTo: search.returnTo === "/invoices/new" ? search.returnTo : undefined }), component: () => <CustomerFormPage returnTo={customerNewRoute.useSearch().returnTo} /> })
const customerDetailRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/customers/$customerId", component: () => <CustomerDetailPage customerId={customerDetailRoute.useParams().customerId} /> })
const customerEditRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/customers/$customerId/edit", component: () => <CustomerFormPage customerId={customerEditRoute.useParams().customerId} /> })
const invoicesRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/invoices", component: InvoicesPage })
const invoiceNewRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/invoices/new", validateSearch: (search: Record<string, unknown>): { customer?: string } => ({ customer: typeof search.customer === "string" ? search.customer : undefined }), component: () => <InvoiceFormPage initialCustomerId={invoiceNewRoute.useSearch().customer} /> })
const invoiceDetailRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/invoices/$invoiceId", component: () => <InvoiceDetailPage invoiceId={invoiceDetailRoute.useParams().invoiceId} /> })
const invoiceEditRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/invoices/$invoiceId/edit", component: () => <InvoiceFormPage invoiceId={invoiceEditRoute.useParams().invoiceId} /> })
const invoicePreviewRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/invoices/$invoiceId/preview", component: () => <InvoiceDetailPage invoiceId={invoicePreviewRoute.useParams().invoiceId} previewOnly /> })
const invoiceSettingsRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/settings/invoice", component: InvoiceSettingsPage })
const documentInboxRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/inbox", component: DocumentInboxPage })
const documentReviewRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/inbox/$documentId", component: () => <DocumentReviewPage documentId={documentReviewRoute.useParams().documentId} /> })
const syncCenterRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/sync", component: SyncCenterPage })
const searchRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/search", component: SearchPage })
const transactionTemplatesRoute = createRoute({ getParentRoute: () => appLayoutRoute, path: "/templates", component: TransactionTemplatesPage })

const routeTree = rootRoute.addChildren([
  loginRoute,
  unavailableRoute,
  appLayoutRoute.addChildren([
    indexRoute,
    onboardingRoute,
    companiesRoute,
    newCompanyRoute,
    companySetupRoute,
    addRoute,
    accountsRoute,
    transactionsRoute,
    receivablesRoute,
    transactionDetailRoute,
    transactionEditRoute,
    taxRoute,
    insightsRoute,
    safeToSpendRoute,
    forecastRoute,
    settingsRoute,
    customersRoute,
    customerNewRoute,
    customerDetailRoute,
    customerEditRoute,
    invoicesRoute,
    invoiceNewRoute,
    invoiceDetailRoute,
    invoiceEditRoute,
    invoicePreviewRoute,
    invoiceSettingsRoute,
    documentInboxRoute,
    documentReviewRoute,
    syncCenterRoute,
    searchRoute,
    transactionTemplatesRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
