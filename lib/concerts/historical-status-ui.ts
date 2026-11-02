/** Public status must fail closed if the feature or processing state is unknown. */
export function historicalCanStart(input:{state:unknown;featureEnabled:boolean;processingEnabled:boolean}){
 return input.state==='not_started'&&input.featureEnabled&&input.processingEnabled;
}
export function historicalFeatureUnavailable(status:{state:string;feature_enabled?:boolean}){
 return ['not_started','disabled'].includes(status.state)&&status.feature_enabled!==true;
}
export function historicalProcessingPaused(status:{state:string;feature_enabled?:boolean;processing_enabled?:boolean}){
 return status.state==='not_started'&&status.feature_enabled===true&&status.processing_enabled!==true;
}
