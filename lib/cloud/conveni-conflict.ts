import type {ConveniConflictOptions} from '../convenis/process';
import {CloudFailure} from './errors';
import {lease,type Context} from './context';

/** Cloud may retry this exact rolled-back transaction; other callers retain
 * their existing error semantics and provider receipts remain authoritative. */
export const cloudConveniConflictOptions:ConveniConflictOptions={
 onDedupConflict(operation){throw new CloudFailure('transient',5,{operation,code:'T19_DEDUP_BUSY'});},
};
export function cloudConveniOptions(c:Context):ConveniConflictOptions{return {...cloudConveniConflictOptions,cloudLease:lease(c)};}
