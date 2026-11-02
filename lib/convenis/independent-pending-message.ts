export function independentPendingMessage(reason:string):string{
 switch(reason){
  case 'INVALID_RECORD':return 'No s’ha pogut identificar aquest registre com a conveni. Cal revisar-ne les dades abans de continuar.';
  case 'STALE_JOB':return 'L’execució seleccionada ja no és la més recent del conveni. Cal revisar la proposta vigent.';
  case 'STALE_ANALYSIS':return 'L’anàlisi no està disponible o les dades d’origen han canviat. Cal revisar-la de nou.';
  case 'INCOMPLETE_COVERAGE':return 'La cobertura documental és incompleta o alguna font ha canviat. Cal contrastar els documents pendents abans d’atribuir imports.';
  case 'PROPOSALS_CHANGED':return 'Les unitats disponibles no coincideixen amb les de l’anàlisi. Cal revisar les propostes abans d’atribuir imports.';
  case 'TARGET_UNRESOLVED':return 'La unitat encara no té prou dades per a aquesta atribució: cal revisar la classificació, el receptor, el repartiment i l’import.';
  case 'SIBLING_IDENTITY_UNRESOLVED':return 'No s’ha trobat el NIF d’una altra unitat en les dades extretes. No es pot confirmar automàticament si correspon a la mateixa entitat; cal contrastar altres evidències. Les unitats queden pendents.';
  case 'SIBLING_NIF_INVALID':return 'El NIF identificat per a una altra unitat no té un format admès. Cal contrastar-lo amb altres evidències; les unitats queden pendents.';
  case 'SIBLING_IDENTITY_UNVERIFIED':return 'Cal contrastar documentalment el nom i NIF de l’altra unitat abans de descartar una duplicitat. Les unitats queden pendents.';
  case 'SIBLING_PERIOD_UNVERIFIED':return 'No s’ha pogut acreditar el període de l’altra unitat. Cal contrastar les evidències; queda pendent de revisió.';
  case 'TARGET_IDENTITY_OR_PERIOD_UNRESOLVED':return 'No s’ha pogut verificar el NIF, el període o el format de l’import d’aquesta unitat. Queda pendent de revisió.';
  case 'POSSIBLE_PERIOD_OVERLAP':return 'Una altra unitat pot correspondre a la mateixa entitat i període. Les unitats queden pendents de contrast per evitar duplicitats.';
  case 'LEGACY_AGGREGATE_REVIEW_REQUIRED':return 'Hi ha una provisió anterior agregada. Cal revisar-la abans d’atribuir imports a les unitats per separat.';
  case 'EXISTING_AMOUNT_UNRESOLVED':return 'No s’ha pogut determinar un import ja registrat en una altra unitat. Cal revisar-lo abans de calcular l’atribució.';
  case 'PUBLIC_TOTAL_UNRESOLVED':return 'No s’ha pogut determinar el total públic del conveni. Queda pendent de contrast abans d’atribuir imports.';
  case 'PUBLIC_TOTAL_EXCEEDED':return 'Els imports proposats i registrats superen el total públic disponible. Cal revisar el repartiment abans de continuar.';
  default:return 'La informació o les evidències necessàries per a aquesta atribució encara estan pendents de revisió.';
 }
}
