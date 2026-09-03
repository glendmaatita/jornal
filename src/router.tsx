import { lazy } from "react"
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import { OnboardingPage } from "@/pages/onboarding-page"
import { isOnboarded } from "@/lib/store"

const HomePage = lazy(() => import("@/pages/home-page").then((m) => ({ default: m.HomePage })))
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

const rootRoute = createRootRoute({
  component: AppShell,
  // Onboarding gate before any route component loads, so the redirect does
  // not pay for lazy chunks of the originally matched route (§66 item 1–3)
  beforeLoad: ({ location }) => {
    if (!isOnboarded() && location.pathname !== "/onboarding") {
      throw redirect({ to: "/onboarding", replace: true })
    }
  },
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
})

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingPage,
})

const addRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/add",
  component: TransactionFormPage,
})

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  component: TransactionsPage,
  validateSearch: (search: Record<string, unknown>): { filter?: string } => ({
    filter: typeof search.filter === "string" ? search.filter : undefined,
  }),
})

const transactionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions/$transactionId",
  component: function TransactionDetailRoute() {
    const { transactionId } = transactionDetailRoute.useParams()
    return <TransactionDetailPage transactionId={transactionId} />
  },
})

const transactionEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions/$transactionId/edit",
  component: TransactionFormPage,
})

const taxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tax",
  component: TaxPage,
})

const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/insights",
  component: InsightsPage,
})

const safeToSpendRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/safe-to-spend",
  component: SafeToSpendPage,
})

const forecastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forecast",
  component: ForecastPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  addRoute,
  transactionsRoute,
  transactionDetailRoute,
  transactionEditRoute,
  taxRoute,
  insightsRoute,
  safeToSpendRoute,
  forecastRoute,
  settingsRoute,
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
