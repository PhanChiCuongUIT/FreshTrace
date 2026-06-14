const { createClient } = require('../frontend/node_modules/@supabase/supabase-js')

async function main() {
  const supabase = createClient(
    'http://127.0.0.1:55421',
    'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  )
  const auth = await supabase.auth.signInWithPassword({
    email: 'shipper@freshtrace.local',
    password: 'FreshTrace!123',
  })
  if (auth.error) throw auth.error
  const profile = await supabase.from('users').select('user_id')
    .eq('auth_user_id', auth.data.user.id)
    .single()
  if (profile.error) throw profile.error
  const userId = profile.data.user_id
  const result = await supabase
    .from('deliveries')
    .select('delivery_id,status,proof_image_url,delivery_batch_checks(batch_id,matched,checked_at),delivery_payment_collections(method,status,remittance_status),orders(order_id,order_code,delivery_address,users(name,phone),payments(method,status),order_items(order_item_id,product_name,quantity,batches(batch_id,batch_code)))')
    .eq('employee_id', userId)
    .order('created_at', { ascending: false })

  if (result.error) throw result.error
  console.log(JSON.stringify({
    ok: true,
    count: result.data.length,
    statuses: result.data.map(item => item.status),
    sample: result.data[0] ?? null,
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
