export class CloudYield extends Error {constructor(public wait=1){super("yield");}}
export type FailureKind='budget'|'transient'|'vercel_quota'|'openai_quota'|'credentials'|'document'|'validation'|'provider_unknown'|'internal';
export class CloudFailure extends Error {
 constructor(public kind:FailureKind,public retryAfter=5){super(kind);}
}
export function publicFailure(error:unknown):CloudFailure {
 return error instanceof CloudFailure?error:new CloudFailure('internal');
}
export const failureLabels:Record<FailureKind,string>={
 budget:'Límit preventiu de consum assolit o model sense pressupost validat. Cal revisar el pressupost abans de reprendre.',
 transient:'Incidència temporal. Es tornarà a intentar.',vercel_quota:'Quota de Vercel esgotada.',openai_quota:'Quota de la IA esgotada.',
 credentials:'Cal revisar les credencials.',document:'Document no processable.',validation:'Resposta no vàlida.',
 provider_unknown:'Resultat de la petició desconegut. Cal revisió abans de repetir-la.',internal:'Execució interrompuda. Cal revisar el diagnòstic tècnic.'
};
