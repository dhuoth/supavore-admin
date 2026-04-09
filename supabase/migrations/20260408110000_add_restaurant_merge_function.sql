create or replace function public.merge_restaurants(
  p_source_restaurant_id uuid,
  p_target_restaurant_id uuid,
  p_display_name_strategy text default 'keep_target',
  p_custom_display_name text default null,
  p_online_ordering_link_strategy text default 'prefer_non_null',
  p_hours_strategy text default 'abort_on_conflict'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_restaurant public.restaurants%rowtype;
  v_target_restaurant public.restaurants%rowtype;
  v_source_item public.menu_items%rowtype;
  v_target_item public.menu_items%rowtype;
  v_source_feedback public.user_meal_feedback%rowtype;
  v_target_feedback public.user_meal_feedback%rowtype;
  v_hours_conflict_count integer := 0;
  v_menu_conflict_count integer := 0;
  v_deleted_duplicate_hours integer := 0;
  v_moved_hours integer := 0;
  v_moved_menu_items integer := 0;
  v_merged_menu_items integer := 0;
  v_repointed_feedback integer := 0;
  v_deduped_feedback integer := 0;
  v_repointed_selections integer := 0;
  v_rows_affected integer := 0;
  v_final_display_name text;
  v_final_online_ordering_link text;
  v_effective_source_canonical_name text;
  v_effective_target_canonical_name text;
begin
  if p_source_restaurant_id is null or p_target_restaurant_id is null then
    raise exception 'Source and target restaurant IDs are required.';
  end if;

  if p_source_restaurant_id = p_target_restaurant_id then
    raise exception 'Source and target restaurants must be different.';
  end if;

  if p_display_name_strategy not in ('keep_target', 'keep_source', 'custom') then
    raise exception 'Unsupported display name strategy: %', p_display_name_strategy;
  end if;

  if p_online_ordering_link_strategy not in ('prefer_target', 'prefer_source', 'prefer_non_null') then
    raise exception 'Unsupported online ordering link strategy: %', p_online_ordering_link_strategy;
  end if;

  if p_hours_strategy <> 'abort_on_conflict' then
    raise exception 'Unsupported hours strategy: %', p_hours_strategy;
  end if;

  select *
  into v_source_restaurant
  from public.restaurants
  where id = p_source_restaurant_id;

  if not found then
    raise exception 'Source restaurant not found.';
  end if;

  select *
  into v_target_restaurant
  from public.restaurants
  where id = p_target_restaurant_id;

  if not found then
    raise exception 'Target restaurant not found.';
  end if;

  select count(*)
  into v_hours_conflict_count
  from public.restaurant_hours source_hour
  join public.restaurant_hours target_hour
    on target_hour.restaurant_id = p_target_restaurant_id
   and source_hour.restaurant_id = p_source_restaurant_id
   and target_hour.day_of_week = source_hour.day_of_week
   and target_hour.window_index = source_hour.window_index
  where target_hour.open_time_local is distinct from source_hour.open_time_local
     or target_hour.close_time_local is distinct from source_hour.close_time_local
     or target_hour.is_closed is distinct from source_hour.is_closed
     or coalesce(target_hour.source, '') <> coalesce(source_hour.source, '');

  if v_hours_conflict_count > 0 then
    raise exception 'Restaurant hours conflict detected. Resolve hour windows before merging.';
  end if;

  select count(*)
  into v_menu_conflict_count
  from public.menu_items source_item
  join public.menu_items target_item
    on target_item.restaurant_id = p_target_restaurant_id
   and source_item.restaurant_id = p_source_restaurant_id
   and coalesce(
         target_item.canonical_name,
         lower(regexp_replace(trim(coalesce(target_item.name, '')), '\s+', ' ', 'g'))
       ) = coalesce(
         source_item.canonical_name,
         lower(regexp_replace(trim(coalesce(source_item.name, '')), '\s+', ' ', 'g'))
       )
  where target_item.name is distinct from source_item.name
     or target_item.base_price is distinct from source_item.base_price
     or target_item.recommended_modification is distinct from source_item.recommended_modification
     or target_item.price_with_modification is distinct from source_item.price_with_modification
     or target_item.ingredients is distinct from source_item.ingredients
     or target_item.dietary_compliance is distinct from source_item.dietary_compliance
     or target_item.is_active is distinct from source_item.is_active;

  if v_menu_conflict_count > 0 then
    raise exception 'Menu item conflict detected. Resolve conflicting menu items before merging.';
  end if;

  v_final_display_name :=
    case p_display_name_strategy
      when 'keep_source' then v_source_restaurant.name
      when 'custom' then nullif(trim(coalesce(p_custom_display_name, '')), '')
      else v_target_restaurant.name
    end;

  if p_display_name_strategy = 'custom' and v_final_display_name is null then
    raise exception 'Custom display name is required when using custom display strategy.';
  end if;

  v_final_online_ordering_link :=
    case p_online_ordering_link_strategy
      when 'prefer_source' then v_source_restaurant.online_ordering_link
      when 'prefer_target' then v_target_restaurant.online_ordering_link
      else coalesce(v_target_restaurant.online_ordering_link, v_source_restaurant.online_ordering_link)
    end;

  update public.restaurants
  set
    name = coalesce(v_final_display_name, name),
    online_ordering_link = v_final_online_ordering_link,
    is_active = true
  where id = p_target_restaurant_id;

  delete from public.restaurant_hours source_hour
  using public.restaurant_hours target_hour
  where source_hour.restaurant_id = p_source_restaurant_id
    and target_hour.restaurant_id = p_target_restaurant_id
    and target_hour.day_of_week = source_hour.day_of_week
    and target_hour.window_index = source_hour.window_index
    and target_hour.open_time_local is not distinct from source_hour.open_time_local
    and target_hour.close_time_local is not distinct from source_hour.close_time_local
    and target_hour.is_closed is not distinct from source_hour.is_closed
    and coalesce(target_hour.source, '') = coalesce(source_hour.source, '');

  get diagnostics v_deleted_duplicate_hours = row_count;

  update public.restaurant_hours
  set restaurant_id = p_target_restaurant_id
  where restaurant_id = p_source_restaurant_id;

  get diagnostics v_moved_hours = row_count;

  for v_source_item in
    select *
    from public.menu_items
    where restaurant_id = p_source_restaurant_id
    order by created_at asc, id asc
  loop
    v_effective_source_canonical_name := coalesce(
      v_source_item.canonical_name,
      lower(regexp_replace(trim(coalesce(v_source_item.name, '')), '\s+', ' ', 'g'))
    );

    select *
    into v_target_item
    from public.menu_items
    where restaurant_id = p_target_restaurant_id
      and coalesce(
            canonical_name,
            lower(regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g'))
          ) = v_effective_source_canonical_name
    order by created_at asc, id asc
    limit 1;

    if not found then
      update public.menu_items
      set
        restaurant_id = p_target_restaurant_id,
        canonical_name = v_effective_source_canonical_name
      where id = v_source_item.id;

      get diagnostics v_rows_affected = row_count;
      v_moved_menu_items := v_moved_menu_items + v_rows_affected;
      continue;
    end if;

    v_effective_target_canonical_name := coalesce(
      v_target_item.canonical_name,
      lower(regexp_replace(trim(coalesce(v_target_item.name, '')), '\s+', ' ', 'g'))
    );

    if v_effective_target_canonical_name <> v_effective_source_canonical_name then
      raise exception 'Unexpected canonical menu item mismatch during merge.';
    end if;

    update public.user_selections
    set
      restaurant_id = p_target_restaurant_id,
      menu_item_id = v_target_item.id
    where menu_item_id = v_source_item.id;

    get diagnostics v_rows_affected = row_count;
    v_repointed_selections := v_repointed_selections + v_rows_affected;

    for v_source_feedback in
      select *
      from public.user_meal_feedback
      where menu_item_id = v_source_item.id
      order by updated_at desc, created_at desc, id desc
    loop
      select *
      into v_target_feedback
      from public.user_meal_feedback
      where user_id = v_source_feedback.user_id
        and menu_item_id = v_target_item.id
      limit 1;

      if not found then
        update public.user_meal_feedback
        set menu_item_id = v_target_item.id
        where id = v_source_feedback.id;

        get diagnostics v_rows_affected = row_count;
        v_repointed_feedback := v_repointed_feedback + v_rows_affected;
      else
        if coalesce(v_source_feedback.updated_at, v_source_feedback.created_at)
          > coalesce(v_target_feedback.updated_at, v_target_feedback.created_at) then
          update public.user_meal_feedback
          set
            feedback_type = v_source_feedback.feedback_type,
            created_at = v_source_feedback.created_at,
            updated_at = v_source_feedback.updated_at
          where id = v_target_feedback.id;
        end if;

        delete from public.user_meal_feedback
        where id = v_source_feedback.id;

        get diagnostics v_rows_affected = row_count;
        v_deduped_feedback := v_deduped_feedback + v_rows_affected;
      end if;
    end loop;

    delete from public.menu_items
    where id = v_source_item.id;

    get diagnostics v_rows_affected = row_count;
    v_merged_menu_items := v_merged_menu_items + v_rows_affected;
  end loop;

  update public.user_selections
  set restaurant_id = p_target_restaurant_id
  where restaurant_id = p_source_restaurant_id;

  get diagnostics v_rows_affected = row_count;
  v_repointed_selections := v_repointed_selections + v_rows_affected;

  update public.restaurants
  set is_active = false
  where id = p_source_restaurant_id;

  return jsonb_build_object(
    'sourceRestaurantId', p_source_restaurant_id,
    'targetRestaurantId', p_target_restaurant_id,
    'deletedDuplicateHours', v_deleted_duplicate_hours,
    'movedHours', v_moved_hours,
    'movedMenuItems', v_moved_menu_items,
    'mergedMenuItems', v_merged_menu_items,
    'repointedSelections', v_repointed_selections,
    'repointedFeedback', v_repointed_feedback,
    'dedupedFeedback', v_deduped_feedback,
    'displayName', v_final_display_name,
    'onlineOrderingLink', v_final_online_ordering_link
  );
end;
$$;

comment on function public.merge_restaurants(uuid, uuid, text, text, text, text) is
  'Atomically merges a source restaurant into a target restaurant, rehoming dependent rows and preserving the target restaurant as the canonical identity.';
