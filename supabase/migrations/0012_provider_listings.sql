-- TRADAR — Phase 5B: real provider listings
--
-- Data only. No table, column or constraint changes: 0011 already models
-- instruments and their provider mappings, and adding a vendor was designed to
-- be rows rather than DDL. This migration is the proof of that design.
--
-- A listing means "this provider names the instrument this way and can serve
-- it". It does NOT mean data will flow — routing additionally requires the
-- adapter to be configured with an API key on the server. That split is
-- deliberate: the catalogue is operator data, credentials are deployment
-- state, and conflating them would make the UI claim availability that
-- depends on an env var it cannot see.

-- ---------------------------------------------------------------------------
-- Twelve Data — forex, spot metals, US equities
--
-- Provider symbols differ from Tradar symbols: pairs and metals are slash
-- separated (EUR/USD, XAU/USD) while equities are plain tickers. Storing the
-- mapping is the whole reason instrument_providers exists.
--
-- Timeframes deliberately exclude H4: Twelve Data exposes 4h only on some
-- plans and instruments, and the adapter does not map it, so listing it would
-- promise something that returns nothing.
-- ---------------------------------------------------------------------------
insert into public.instrument_providers
  (instrument_id, provider, provider_symbol, supports_historical, supports_realtime, timeframes, priority)
select i.id, 'twelvedata', v.provider_symbol, true, false,
       array['M1','M5','M15','H1','D1'], 20
  from public.instruments i
  join (values
    ('EURUSD', 'EUR/USD'),
    ('GBPUSD', 'GBP/USD'),
    ('USDJPY', 'USD/JPY'),
    ('AUDUSD', 'AUD/USD'),
    ('XAUUSD', 'XAU/USD'),
    ('XAGUSD', 'XAG/USD'),
    ('AAPL',   'AAPL'),
    ('MSFT',   'MSFT'),
    ('TSLA',   'TSLA')
  ) as v(symbol, provider_symbol) on v.symbol = i.symbol
on conflict (instrument_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- Massive — futures
--
-- ES and NQ are contract ROOTS, not tradeable tickers. A real ticker is
-- root + month code + two-digit year (ESZ24). The adapter refuses to fetch
-- against a bare root rather than guessing a contract, because guessing would
-- either request something that does not exist or silently stitch different
-- contracts across a rollover and present the seam as a price move.
--
-- provider_symbol therefore holds the root, and metadata records that a
-- contract must be configured before data can flow. An operator sets
-- provider_symbol to a specific contract when they want that contract's
-- history; a rollover engine that maintains a continuous series is a later
-- phase.
--
-- These listings are inserted INACTIVE. An inactive listing is not routed, so
-- the catalogue reports "no source" for ES/NQ — which is the truth today —
-- while recording the intended mapping for whoever configures it.
-- ---------------------------------------------------------------------------
insert into public.instrument_providers
  (instrument_id, provider, provider_symbol, supports_historical, supports_realtime, timeframes, priority, active, metadata)
select i.id, 'massive', i.symbol, true, false,
       array['M1','M5','M15','H1','D1'], 20, false,
       jsonb_build_object(
         'contract_root', i.symbol,
         'requires_contract', true,
         'note', 'Set provider_symbol to a specific contract (e.g. ESZ24) and set active = true.'
       )
  from public.instruments i
 where i.symbol in ('ES', 'NQ')
on conflict (instrument_id, provider) do nothing;
