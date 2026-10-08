import {ArchivedSourceUnavailableError,SourceContentChangedError} from '../source-storage';
import {CloudFailure} from './errors';

export function documentIssueKind(error:unknown):'source_changed'|'archive_unavailable'|'document'|null {
 if(error instanceof SourceContentChangedError)return 'source_changed';
 if(error instanceof ArchivedSourceUnavailableError)return 'archive_unavailable';
 if(error instanceof CloudFailure&&error.kind==='document')return 'document';
 return null;
}
