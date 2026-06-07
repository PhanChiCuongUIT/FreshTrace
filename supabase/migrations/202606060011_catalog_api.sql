create or replace function public.search_products(
  p_query text default null,
  p_category_id uuid default null,
  p_certificate text default null,
  p_rescue_only boolean default false,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns table (
  product_id uuid,
  product_name text,
  description text,
  unit text,
  image_url text,
  certificate text,
  category_id uuid,
  category_name text,
  supplier_id uuid,
  supplier_name text,
  batch_id uuid,
  batch_code text,
  expire_date date,
  origin_location text,
  quantity_available integer,
  current_price numeric,
  is_rescue boolean,
  rescue_discount_percent integer,
  average_rating numeric,
  review_count bigint
) language sql stable security definer set search_path = public
as $$
  select
    p.product_id,
    p.name,
    p.description,
    p.unit,
    p.image_url,
    p.certificate,
    c.category_id,
    c.name,
    s.supplier_id,
    s.name,
    chosen.batch_id,
    chosen.batch_code,
    chosen.expire_date,
    chosen.origin_location,
    chosen.quantity_available,
    coalesce(chosen.rescue_price, chosen.normal_price),
    chosen.rescue_price is not null,
    chosen.discount_percent,
    coalesce(review_stats.average_rating, 0),
    coalesce(review_stats.review_count, 0)
  from public.products p
  join public.categories c on c.category_id = p.category_id and c.status = 'active'
  join public.suppliers s on s.supplier_id = p.supplier_id and s.status = 'approved'
  join lateral (
    select
      b.batch_id,
      b.batch_code,
      b.expire_date,
      b.origin_location,
      i.quantity_available - i.quantity_reserved as quantity_available,
      normal.price as normal_price,
      rescue.rescue_price,
      rescue.discount_percent
    from public.batches b
    join public.inventory i on i.batch_id = b.batch_id
    left join lateral (
      select pr.price
      from public.prices pr
      where pr.product_id = p.product_id
        and (pr.batch_id = b.batch_id or pr.batch_id is null)
        and pr.price_type in ('normal', 'promotion')
        and current_date >= pr.start_date
        and (pr.end_date is null or current_date <= pr.end_date)
      order by (pr.batch_id is not null) desc,
        (pr.price_type = 'promotion') desc,
        pr.created_at desc
      limit 1
    ) normal on true
    left join lateral (
      select d.rescue_price, d.discount_percent
      from public.fresh_rescue_deals d
      where d.batch_id = b.batch_id
        and d.status = 'active'
        and now() between d.start_at and d.end_at
      order by d.created_at desc
      limit 1
    ) rescue on true
    where b.product_id = p.product_id
      and b.status in ('available', 'near_expiry')
      and b.expire_date >= current_date
      and i.quantity_available - i.quantity_reserved > 0
      and (not p_rescue_only or rescue.rescue_price is not null)
      and coalesce(rescue.rescue_price, normal.price) is not null
      and (p_min_price is null or coalesce(rescue.rescue_price, normal.price) >= p_min_price)
      and (p_max_price is null or coalesce(rescue.rescue_price, normal.price) <= p_max_price)
    order by (rescue.rescue_price is not null) desc, b.expire_date
    limit 1
  ) chosen on true
  left join lateral (
    select round(avg(r.rating), 2) average_rating, count(*) review_count
    from public.reviews r where r.product_id = p.product_id
  ) review_stats on true
  where p.status = 'active'
    and (p_query is null or trim(p_query) = ''
      or p.name ilike '%' || trim(p_query) || '%'
      or coalesce(p.description, '') ilike '%' || trim(p_query) || '%')
    and (p_category_id is null or p.category_id = p_category_id)
    and (p_certificate is null or p.certificate ilike '%' || trim(p_certificate) || '%')
  order by chosen.rescue_price is not null desc, p.name
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0)
$$;

grant execute on function public.search_products(
  text, uuid, text, boolean, numeric, numeric, integer, integer
) to anon, authenticated;
