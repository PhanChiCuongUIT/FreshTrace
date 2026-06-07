import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { ProtectedRoute } from './app/ProtectedRoute'
import { RoleHome } from './app/RoleHome'
import { LoadingState } from './components/AsyncState'

const LoginPage = lazy(() => import('./features/auth/LoginPage').then(module => ({ default: module.LoginPage })))
const RegisterPage = lazy(() => import('./features/auth/RegisterPage').then(module => ({ default: module.RegisterPage })))
const ResetPasswordPage = lazy(() => import('./features/auth/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })))
const ProductsPage = lazy(() => import('./features/customer/ProductsPage').then(module => ({ default: module.ProductsPage })))
const ProductDetailPage = lazy(() => import('./features/customer/ProductDetailPage').then(module => ({ default: module.ProductDetailPage })))
const CartPage = lazy(() => import('./features/customer/CartPage').then(module => ({ default: module.CartPage })))
const OrdersPage = lazy(() => import('./features/customer/OrdersPage').then(module => ({ default: module.OrdersPage })))
const TracePage = lazy(() => import('./features/customer/TracePage').then(module => ({ default: module.TracePage })))
const AssistantPage = lazy(() => import('./features/customer/AssistantPage').then(module => ({ default: module.AssistantPage })))
const PaymentResultPage = lazy(() => import('./features/customer/PaymentResultPage').then(module => ({ default: module.PaymentResultPage })))
const ChatPage = lazy(() => import('./features/shared/ChatPage').then(module => ({ default: module.ChatPage })))
const NotificationsPage = lazy(() => import('./features/shared/NotificationsPage').then(module => ({ default: module.NotificationsPage })))
const ProfilePage = lazy(() => import('./features/shared/ProfilePage').then(module => ({ default: module.ProfilePage })))
const ManagerDashboard = lazy(() => import('./features/manager/ManagerDashboard').then(module => ({ default: module.ManagerDashboard })))
const ManagerCatalogPage = lazy(() => import('./features/manager/ManagerCatalogPage').then(module => ({ default: module.ManagerCatalogPage })))
const ManagerProductEditorPage = lazy(() => import('./features/manager/ManagerProductEditorPage').then(module => ({ default: module.ManagerProductEditorPage })))
const ManagerBatchEditorPage = lazy(() => import('./features/manager/ManagerBatchEditorPage').then(module => ({ default: module.ManagerBatchEditorPage })))
const ManagerOrdersPage = lazy(() => import('./features/manager/ManagerOrdersPage').then(module => ({ default: module.ManagerOrdersPage })))
const ShipperDashboard = lazy(() => import('./features/shipper/ShipperDashboard').then(module => ({ default: module.ShipperDashboard })))
const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard').then(module => ({ default: module.AdminDashboard })))
const AdminUsersPage = lazy(() => import('./features/admin/AdminUsersPage').then(module => ({ default: module.AdminUsersPage })))
const AdminReportsPage = lazy(() => import('./features/admin/AdminReportsPage').then(module => ({ default: module.AdminReportsPage })))
const AdminMonitoringPage = lazy(() => import('./features/admin/AdminMonitoringPage').then(module => ({ default: module.AdminMonitoringPage })))
const AdminFinancePage = lazy(() => import('./features/admin/AdminFinancePage').then(module => ({ default: module.AdminFinancePage })))

export default function App() {
  return <Suspense fallback={<div className="p-6"><LoadingState/></div>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppShell />}>
        <Route path="/" element={<RoleHome />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/:productId" element={<ProductDetailPage />} />
        <Route path="/rescue" element={<ProductsPage rescueOnly />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:orderId" element={<OrdersPage />} />
        <Route path="/reports/:reportId" element={<OrdersPage />} />
        <Route path="/trace" element={<TracePage />} />
        <Route path="/trace/:batchId" element={<TracePage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/payment/success" element={<PaymentResultPage />} />
        <Route path="/payment/cancel" element={<PaymentResultPage cancelled />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:roomId" element={<ChatPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route element={<ProtectedRoute roles={['manager', 'admin']} />}>
          <Route path="/manager" element={<ManagerDashboard />} />
          <Route path="/manager/catalog" element={<ManagerCatalogPage />} />
          <Route path="/manager/catalog/products/new" element={<ManagerProductEditorPage />} />
          <Route path="/manager/catalog/products/:recordId/edit" element={<ManagerProductEditorPage />} />
          <Route path="/manager/catalog/batches/new" element={<ManagerBatchEditorPage />} />
          <Route path="/manager/catalog/batches/:recordId/edit" element={<ManagerBatchEditorPage />} />
          <Route path="/manager/catalog/:section" element={<ManagerCatalogPage />} />
          <Route path="/manager/orders" element={<ManagerOrdersPage />} />
          <Route path="/manager/orders/:orderId" element={<ManagerOrdersPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={['employee', 'admin']} />}>
          <Route path="/shipper" element={<ShipperDashboard />} />
          <Route path="/shipper/orders/:orderId" element={<ShipperDashboard />} />
        </Route>
        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/reports" element={<AdminReportsPage />} />
          <Route path="/admin/reports/:reportId" element={<AdminReportsPage />} />
          <Route path="/admin/monitoring" element={<AdminMonitoringPage />} />
          <Route path="/admin/orders/:orderId" element={<AdminMonitoringPage />} />
          <Route path="/admin/finance" element={<AdminFinancePage />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>
}
