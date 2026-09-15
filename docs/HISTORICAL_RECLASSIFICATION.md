# Actualització de classificacions antigues

La campanya `normative-history-v1` selecciona únicament registres amb propostes antigues, sense cap resultat normatiu, decisió humana, provisió o feina activa. No importa dades ni reclassifica aprovacions. La selecció, el lot i la tasca són transaccionals; una nova petició retorna el mateix lot. Els treballs i candidats previs es conserven. Una revisió durant el procés impedeix noves escriptures de domini del treball històric.

En producció, Revisió mostra l’acció d’actualització i l’enllaç al progrés a Lots. Els resultats nous mostren la classificació al llistat plegat, separada de l’estat de revisió. «Fora de cartera» és una proposta respecte del catàleg validat; no és un judici d’il·legalitat. Classificacions recull les decisions revisades. No cal tornar a importar fitxers. Actualitzar la pàgina recupera els resultats disponibles.

Només Vercel inicia aquesta campanya. Els comandaments i la configuració locals no canvien. La conciliació i la recuperació de Lots continuen aplicant-se. Errors documentals o de validació queden com a incidències; no s’inventa una classificació per donar-los per completats.

## Límit de consum

La campanya té un límit preventiu de 4 USD d’IA. Abans de cada petició es reserva el cost màxim del context de text de GPT-4o mini i dels tokens de sortida autoritzats. Una reserva transaccional no es duplica; en rebre ús es liquida amb els tokens reals, sense descompte de memòria cau. Un resultat incert manté la reserva. Si falta pressupost o el model no té una tarifa validada, la tasca es pausa abans de cridar el proveïdor. Reprendre no amplia el límit. Les quotes de Vercel i els impostos no formen part d’aquest límit preventiu; el proveïdor conserva la facturació definitiva.

Referència de tarifes de text (consulta 2026-09-15): [OpenAI GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), 0,15/0,60 USD per milió de tokens d’entrada/sortida. Revisar aquesta configuració abans d’utilitzar altres models o tarifes.

## Validació

Proves amb fixtures sintètiques i transacció revertida en `cartera_cloud_test_*`: més de 50 registres, doble arrencada, exclusió de decisions i classificacions existents, conservació de candidats, revisió concurrent, reserves idempotents, liquidació, límit i model desconegut. Les comprovacions de producció i els seus recomptes es conserven fora del repositori.
