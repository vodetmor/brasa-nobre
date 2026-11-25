-- FC Closet: catálogo, dados da loja, fotos e permissões.
create schema if not exists private;

-- Quem pode editar a loja (preenchido só pelo SQL, nunca pelo site).
create table private.admins (user_id uuid primary key references auth.users(id) on delete cascade);

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.admins a where a.user_id = (select auth.uid())) $$;
revoke all on function private.is_admin() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;
-- Porta de entrada para o painel perguntar "posso editar?" (roda com os direitos de quem chama).
create or replace function public.e_admin() returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.is_admin() $$;
grant execute on function public.e_admin() to anon, authenticated;

create table public.loja (
  id int primary key default 1 check (id = 1),
  whatsapp text not null default '' check (whatsapp ~ '^[0-9]{0,15}$'),
  instagram text not null default '' check (instagram = '' or instagram ~ '^https://'),
  aviso text not null default '',
  hero_sobretitulo text not null default '',
  hero_titulo text not null default '',
  hero_foto_1 text not null default '',
  hero_foto_2 text not null default '',
  sobre_texto text not null default '',
  sobre_foto text not null default '',
  parcelas int not null default 0 check (parcelas between 0 and 12),
  guia_medidas text not null default '' check (char_length(guia_medidas) <= 1200),
  pagamento text not null default '' check (char_length(pagamento) <= 600),
  entrega text not null default '' check (char_length(entrega) <= 600),
  trocas text not null default '' check (char_length(trocas) <= 900)
);

create table public.categorias (
  nome text primary key check (char_length(btrim(nome)) between 1 and 24),
  ordem int not null default 0
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  categoria text not null references public.categorias(nome) on update cascade,
  preco numeric(10,2) not null default 0 check (preco >= 0),
  tamanhos text[] not null default '{}',
  descricao text not null default '' check (char_length(descricao) <= 600),
  fotos text[] not null default '{}',
  novidade boolean not null default true,
  disponivel boolean not null default true,
  visivel boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  modelo text not null default '' check (char_length(modelo) <= 40),
  detalhes text not null default '' check (char_length(detalhes) <= 800)
);
create index produtos_categoria_idx on public.produtos (categoria);

alter table public.loja enable row level security;
alter table public.categorias enable row level security;
alter table public.produtos enable row level security;

revoke all on public.loja, public.categorias, public.produtos from anon, authenticated;
grant select on public.loja, public.categorias, public.produtos to anon, authenticated;
grant update on public.loja to authenticated;
grant insert, update, delete on public.categorias, public.produtos to authenticated;

create policy loja_ler on public.loja for select using (true);
create policy loja_editar on public.loja for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy cat_ler on public.categorias for select using (true);
create policy cat_criar on public.categorias for insert to authenticated with check ((select private.is_admin()));
create policy cat_editar on public.categorias for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy cat_apagar on public.categorias for delete to authenticated using ((select private.is_admin()));
create policy prod_ler on public.produtos for select using (visivel or (select private.is_admin()));
create policy prod_criar on public.produtos for insert to authenticated with check ((select private.is_admin()));
create policy prod_editar on public.produtos for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy prod_apagar on public.produtos for delete to authenticated using ((select private.is_admin()));

-- Fotos: leitura pública pela URL; envio e remoção só da dona.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 5242880, array['image/webp','image/jpeg']);
create policy fotos_ver on storage.objects for select to authenticated using (bucket_id = 'fotos' and (select private.is_admin()));
create policy fotos_enviar on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and (select private.is_admin()));
create policy fotos_apagar on storage.objects for delete to authenticated using (bucket_id = 'fotos' and (select private.is_admin()));

-- Dados iniciais
insert into public.loja (id, whatsapp, instagram, aviso, hero_sobretitulo, hero_titulo, hero_foto_1, hero_foto_2, sobre_texto, sobre_foto)
values (1, '5561996381700', 'https://www.instagram.com/fc.closeet/', 'Atendimento personalizado pelo WhatsApp',
  'Vestido Júlia', 'Estilo em cada detalhe', 'julia-vinho-2', 'julia-branco-2',
  'Moda feminina pensada nos detalhes: caimento, cor e conforto para você se expressar do seu jeito. Escolha pelo site, monte a sacola e fale direto com a Fernanda.', 'julia-branco-1');
insert into public.categorias (nome, ordem) values ('Preto', 1), ('Vinho', 2), ('Branco', 3);
insert into public.produtos (nome, categoria, ordem, descricao, fotos)
select 'Vestido Júlia ' || c, c, o,
  'Longo tomara que caia com torção no busto, recorte em tule na cintura e faixas soltas na lateral.',
  array(select 'julia-' || lower(c) || '-' || n from generate_series(1,4) n)
from (values ('Preto',1),('Vinho',2),('Branco',3)) v(c,o);
