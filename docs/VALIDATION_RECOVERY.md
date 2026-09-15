# Recuperació de validacions

Les referències normatives es vinculen al codi fulla validat al servidor. La IA no ha de reproduir literalment una referència per poder continuar: el contrast independent contra la fitxa concreta continua sent obligatori abans de persistir una correspondència positiva. Cap normalització admet pares, prestacions excloses o codis desconeguts.

Els candidats declarats incompatibles s’exclouen; si no en queda cap o no s’acredita l’abast, el resultat és evidència insuficient. Les puntuacions originals es conserven i la validació final ordena el principal. Una cita literal amb ordinal equivocat es vincula als fragments del mateix expedient que la contenen exactament. Si es repeteix, es conserven totes les referències coincidents; no se’n tria una arbitràriament. Les cites inexistents es rebutgen. Les opcions del esquema estricte utilitzen fragments literals sense cometes, barres inverses ni caràcters de control; el text font no es modifica.

Una resposta negativa sense motiu o evidència rep una única reparació documentada (`contract-repair-v1`). Aquesta reparació no pot crear candidats ni afirmar fora de cartera. Es registra, es valida i es comptabilitza dins del pressupost existent. Els errors del proveïdor confirmats es desen com a `rejected` en el diari privat; els resultats incerts continuen requerint resolució explícita.

La recuperació explícita `retry_validation` reutilitza la tasca, el lot, les respostes rebudes i la comptabilitat. Cada revisió de recuperació és idempotent. Només recupera errors de validació del darrer treball d’un registre sense decisió humana, provisió ni anàlisi completada. Arxiva el diagnòstic anterior en punts de control privats, sense esborrar dades. No recupera errors documentals ni executors actius i no amplia el pressupost.

Compatibilitat amb el diari anterior: un audit en `sending` només es pot recuperar si el treball havia acabat amb `validation`, havia rebut el matching i havia entrat a l’auditoria. En aquella implementació, aquesta combinació provenia d’un rebuig confirmat del proveïdor; un resultat desconegut pausava la tasca amb `provider_unknown`. Altres entrades `sending` impedeixen la recuperació. Les respostes `received` no es tornen a demanar.

Proves: fixtures sintètiques en `tests/cloud-candidate-normalization.test.ts`, `tests/cloud-positive-audit.test.ts`, `tests/cloud-provider.test.ts` i `tests/integration/validation-recovery.sql`. Els diagnòstics i les còpies de producció romanen fora del repositori.
