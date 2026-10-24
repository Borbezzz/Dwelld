import sharp from 'sharp';
import type {DamageEvidence} from '../damage-identity';
/** Small pixel signatures help associate near-static views; never used without location evidence. */
export async function damageViewSignature(image:Buffer){try{return (await sharp(image).resize(16,16,{fit:'fill'}).greyscale().raw().toBuffer()).toString('hex');}catch{return undefined;}}
export async function damageCropSignature(image:Buffer,box:DamageEvidence['boundingBox']){
 try{if(!box)return undefined;const {width,height}=await sharp(image).metadata();if(!width||!height)return undefined;
 const left=Math.max(0,Math.floor(box.x*width)),top=Math.max(0,Math.floor(box.y*height)),w=Math.min(width-left,Math.ceil(box.width*width)),h=Math.min(height-top,Math.ceil(box.height*height));if(w<2||h<2)return undefined;
 return (await sharp(image).extract({left,top,width:w,height:h}).resize(16,16,{fit:'fill'}).greyscale().raw().toBuffer()).toString('hex');}catch{return undefined;}
}
