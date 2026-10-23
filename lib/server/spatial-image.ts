import sharp from "sharp";
export async function normalizeSpatialImage(original:Buffer){
 const metadata=await sharp(original,{limitInputPixels:24_000_000}).metadata();
 let image=await sharp(original,{limitInputPixels:24_000_000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
 if(image.length>3*1024*1024)image=await sharp(image).resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).jpeg({quality:70}).toBuffer();
 if(image.length>3*1024*1024)throw new Error('Native image could not be normalized within the analysis limit');
 return {image,orientation:metadata.orientation||1,width:metadata.width,height:metadata.height};
}
