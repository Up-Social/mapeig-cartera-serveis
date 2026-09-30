import type {ReactNode} from 'react';
type Props={children?:ReactNode;className?:string;stateKey?:string;defaultValue?:string[];value?:string;keepMounted?:boolean;trailingAction?:ReactNode};
/** Detail information is always visible. Native select controls remain interactive. */
export function StableAccordion(props:Props){return <div className={props.className}>{props.children}</div>;}
export function AccordionItem(props:Props){return <article className={props.className}>{props.children}</article>;}
export function AccordionTrigger(props:Props){return <div className={props.className}>{props.children}{props.trailingAction}</div>;}
export function AccordionContent(props:Props){return <div className={props.className}>{props.children}</div>;}
