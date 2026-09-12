# Validación del matching positivo remoto

El esquema de producción limita los códigos a servicios hoja elegibles del catálogo oficial validado. Una comprobación independiente contrasta cada candidato positivo con su ficha exacta y los fragmentos del expediente. No confunde la norma, que define el servicio, con el documento, que acredita los hechos.

Las citas permitidas proceden del documento y se verifican literalmente. Los candidatos incompatibles se eliminan sin inventar sustitutos. Se conservan puntuaciones y orden; en empate se mantiene el orden original. Si no queda ningún candidato acreditado, el resultado es evidencia insuficiente, nunca fuera de cartera por eliminación. La revisión humana sigue siendo necesaria: una cita literal y una puntuación alta no garantizan por sí solas una correspondencia correcta.

La fase `positive-audit-v2` tiene diario privado y consumo idempotente. La migración `20260913103000_cloud_positive_audit_usage.sql` admite esta fase sin recalcular consumos históricos. La recuperación conserva respuestas previas y renueva la reserva antes de la comprobación.

Validación técnica: 78 pruebas, tipos, lint y compilación. La prueba SQL aislada comprueba que repetir el registro de consumo no lo duplica. Se incluyen casos de códigos o títulos intercambiados, candidatos incompatibles y citas inexistentes.

Los informes con consumos de cuenta, identificadores de muestras y resultados de producción se conservan fuera del repositorio. Las cuotas deben comprobarse en la cuenta real; no se deduce saldo de límites publicados ni se garantiza capacidad gratuita para toda la base.

Los comandos locales permanecen sin cambios. Las funciones y Workflows se despliegan con la aplicación en Vercel; no se introducen nuevas Edge Functions de Supabase.
