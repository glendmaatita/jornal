import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import { HomePage } from "@/pages/home-page"
import { InsightsPage } from "@/pages/insights-page"
import { OnboardingPage } from "@/pages/onboarding-page"
import { SafeToSpendPage } from "@/pages/safe-to-spend-page"
import { ForecastPage } from "@/pages/forecast-page"
import { SettingsPage } from "@/pages/settings-page"
import { TaxPage } from "@/pages/tax-page"
import { TransactionDetailPage } from "@/pages/transaction-detail-page"
import { TransactionFormPage } from "@/pages/transaction-form-page"
import { TransactionsPage } from "@/pages/transactions-page"

const rootRoute = createRootRoute({
  component: AppShell,
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
