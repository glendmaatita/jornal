/* eslint-disable react-refresh/only-export-components -- router config module, not a component file */
import { lazy } from "react"
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import { OnboardingPage } from "@/pages/onboarding-page"
import { LoginPage } from "@/pages/login-page"
import { isOnboarded } from "@/lib/store"
import { pb } from "@/lib/pb"

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

const rootRoute = createRootRoute({})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
})

// Pathless authenticated layout: everything below requires a logged-in tenant.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AppShell,
  beforeLoad: ({ location }) => {
    if (!pb.authStore.isValid) {
      throw redirect({ to: "/login", replace: true })
    }
    // Onboarding gate before any route component loads, so the redirect does
    // not pay for lazy chunks of the originally matched route (§66 item 1–3)
    if (!isOnboarded() && location.pathname !== "/onboarding") {
      throw redirect({ to: "/onboarding", replace: true })
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

const addRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/add",
  component: TransactionFormPage,
})

const transactionsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/transactions",
  component: TransactionsPage,
  validateSearch: (search: Record<string, unknown>): { filter?: string } => ({
    filter: typeof search.filter === "string" ? search.filter : undefined,
  }),
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
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
