export type ConveniDiagnostic={code:string;message:string;field?:string;index?:number;recipient?:string;period?:string;documentId?:string;page?:number;quote?:string;requiresVisualReview?:boolean;expected_cents?:number|null;allocated_cents?:number;unallocated_cents?:number|null;difference_cents?:number;units?:Array<{index:number;amount_cents:number|null;classification:string}>};
export class ConveniValidationError extends Error {
 constructor(readonly diagnostic:ConveniDiagnostic,readonly diagnostics:ConveniDiagnostic[]=[diagnostic]){super(diagnostic.message);this.name='ConveniValidationError';}
}
