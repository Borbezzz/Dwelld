import {Armchair,Bath,BedDouble,Box,DoorOpen,LampDesk,Refrigerator,Table,Toilet,Tv,Warehouse} from 'lucide-react';
export default function ObjectIcon({label,size=16}:{label:string;size?:number}){
 const name=label.toLowerCase();const Icon=/bed/.test(name)?BedDouble:/chair|sofa|couch/.test(name)?Armchair:/table|desk/.test(name)?Table:/storage|cabinet|wardrobe|shelf/.test(name)?Warehouse:/door/.test(name)?DoorOpen:/fridge|refrigerator/.test(name)?Refrigerator:/toilet/.test(name)?Toilet:/bath|sink/.test(name)?Bath:/lamp/.test(name)?LampDesk:/tv|television/.test(name)?Tv:Box;
 return <Icon size={size} aria-hidden="true"/>;
}
