import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, PageHeader } from '../../components/Page'
import { ErrorState, LoadingState } from '../../components/AsyncState'
import { callFunction } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import type { Role } from '../../lib/types'
import { Search, TriangleAlert } from 'lucide-react'

type User = { user_id: string; name: string; email: string; status: 'active' | 'inactive' | 'banned'; roles: { role_name: Role } }

export function AdminUsersPage() {
  const client = useQueryClient()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'employee' as Role })
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const users = useQuery({ queryKey: ['admin-users'], queryFn: async () => {
    const result = await supabase.from('users').select('user_id,name,email,status,roles(role_name)').order('created_at', { ascending: false })
    if (result.error) throw result.error
    return result.data as unknown as User[]
  }})
  const create = async () => {
    try { await callFunction('admin-users', { action: 'create', ...form }); setForm({ name: '', email: '', password: '', role: 'employee' }); client.invalidateQueries({ queryKey: ['admin-users'] }) } catch (error) { alert(String(error)) }
  }
  const update = async (userId: string, values: { role?: Role; status?: User['status'] }) => {
    const user = users.data?.find(item => item.user_id === userId)
    const change = values.role ? `change ${user?.name}'s role from ${user?.roles.role_name} to ${values.role}` : `change ${user?.name}'s status to ${values.status}`
    if (!confirm(`Warning: ${change}. Active orders or deliveries will block unsafe changes. Continue?`)) return
    try { await callFunction('admin-users', { action: 'update', userId, ...values }); client.invalidateQueries({ queryKey: ['admin-users'] }) } catch (error) { alert(String(error)) }
  }
  if (users.isLoading) return <LoadingState />
  if (users.error) return <ErrorState error={users.error} />
  const filtered = users.data?.filter(user =>
    (!query || `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase()))
    && (!roleFilter || user.roles.role_name === roleFilter)
    && (!statusFilter || user.status === statusFilter)
  )
  return <div><PageHeader eyebrow="Identity" title="User administration" />
    <form className="card mt-6 grid gap-3 p-5 md:grid-cols-5" onSubmit={event => { event.preventDefault(); create() }}><input className="input" required placeholder="Full name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/><input className="input" required type="email" placeholder="Email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })}/><input className="input" required minLength={8} type="password" placeholder="Password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })}/><select className="input" value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })}><option value="employee">Employee</option><option value="manager">Manager</option><option value="admin">Admin</option><option value="customer">Customer</option></select><button className="btn-primary">Create account</button></form>
    <div className="card mt-5 p-4"><div className="flex items-center gap-2 text-sm text-amber-800"><TriangleAlert size={17}/><span>Role changes are audited by workflow rules. Users with open orders or active deliveries cannot be reassigned.</span></div><div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_180px]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/35" size={18}/><input className="input" style={{ paddingLeft: '2.75rem' }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or email"/></label><select className="input" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All roles</option>{['customer','employee','manager','admin'].map(role => <option key={role}>{role}</option>)}</select><select className="input" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option><option>active</option><option>inactive</option><option>banned</option></select></div></div>
    <div className="card mt-5 overflow-x-auto"><table className="min-w-[760px] w-full text-left text-sm"><thead className="border-b"><tr><th className="p-4">User</th><th>Role</th><th>Status</th><th>Controls</th></tr></thead><tbody>{filtered?.map(user => <tr key={user.user_id} className="border-b last:border-0"><td className="p-4"><b className="block">{user.name}</b><span className="text-black/50">{user.email}</span></td><td><select className="input max-w-36 py-2" value={user.roles.role_name} onChange={event => update(user.user_id, { role: event.target.value as Role })}>{['customer','employee','manager','admin'].map(role => <option key={role}>{role}</option>)}</select></td><td><Badge tone={user.status === 'active' ? 'green' : user.status === 'banned' ? 'red' : 'orange'}>{user.status}</Badge></td><td><select className="input max-w-36 py-2" value={user.status} onChange={event => update(user.user_id, { status: event.target.value as User['status'] })}><option value="active">active</option><option value="inactive">inactive</option><option value="banned">banned</option></select></td></tr>)}</tbody></table></div>
  </div>
}
