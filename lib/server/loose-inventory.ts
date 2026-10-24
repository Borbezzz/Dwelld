import type {LooseItemObservation} from './damage';
export type LooseView={ref:string;timestampSeconds:number;objects:(Omit<LooseItemObservation,'description'>&{description?:string})[]};
/** Maximum simultaneous observations, never sum counts across moving-camera views. */
export function representativeLooseViews(views:LooseView[]){
 const best=new Map<string,LooseView>();
 for(const view of views)for(const label of new Set(view.objects.map(o=>o.label))){
  if(view.objects.filter(o=>o.label===label).length>(best.get(label)?.objects.filter(o=>o.label===label).length||0))best.set(label,view);
 }
 return best;
}
