import type {ConveniUnit} from './contract';
import {conveniMissingFieldDiagnostics} from './contract';
import type {ReviewOutcome} from '../review-contract';

/** A model proposal or a decision from another run must not preselect a
 * rejection. Preserve a decision from this job without asserting that its
 * underlying documents are still current. */
export function initialConveniReviewOutcome(
 classification:ConveniUnit['classification'],reviewedOutcome:ReviewOutcome|null,
 reviewedJob:string|null,job:string,
):ReviewOutcome {
 if(reviewedOutcome&&reviewedJob===job)return reviewedOutcome;
 return ({in_portfolio:'select',out_of_portfolio:'outside',discarded:'insufficient',insufficient_evidence:'insufficient'} as const)[classification]??'insufficient';
}

export function initialConveniServiceCode(proposedCode:string|null,reviewedCode:string|null,reviewedJob:string|null,job:string):string {
 return (reviewedJob===job?reviewedCode:null)??proposedCode??'';
}

/** Presentation only: an empty field means the analysis did not identify it,
 * not that the source has been exhaustively searched. */
export function missingConveniFieldMessages(unit:ConveniUnit):string[] {
 return conveniMissingFieldDiagnostics([unit]).map(issue=>issue.message);
}

/** Remount local form state when its proposal or decision identity changes. */
export function conveniUnitFormKey(unitId:string,jobId:string,reviewId:string|null,reviewedJob:string|null):string {
 return JSON.stringify([unitId,jobId,reviewId,reviewedJob]);
}
export function conveniConceptFormKey(index:number,conceptHash:string|null,sourceHash:string|null,reviewId:string|null,parentReviewId:string|null,isCurrent:boolean|null):string {
 return JSON.stringify([index,conceptHash,sourceHash,reviewId,parentReviewId,isCurrent]);
}
