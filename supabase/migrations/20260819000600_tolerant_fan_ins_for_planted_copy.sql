-- Give the planted copy's fan-ins the tolerance rule templates now apply.
--
-- 20260819000500 copied its nodes from rows planted before
-- `tolerates_partial_inputs` existed, so the copy's reduce and report
-- fan-ins are strict: one failed inspector would cost the synthesis of the
-- four that survived. Console-planned graphs already default aggregating
-- capabilities (extraction, synthesis, reporting) with real dependencies
-- to tolerant; this applies exactly that rule to the one planted copy,
-- keyed by capability and incoming edges rather than by node names, so it
-- says what it means anywhere it runs. Idempotent by shape — the second
-- application finds nothing left to change.

update public.graph_nodes n
   set tolerates_partial_inputs = true
 where n.graph_id = 'b7e2a9d4-3c61-4f8e-9a05-2d84c1f6b730'
   and n.capability in ('extraction', 'synthesis', 'reporting')
   and exists (select 1 from public.graph_edges e where e.to_node_id = n.id)
   and n.tolerates_partial_inputs = false;
