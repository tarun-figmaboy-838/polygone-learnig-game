// Register complete generated poses. No body masks, extracted tools or erased pixels.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage();
    const source = fs.readFileSync(path.join(root, 'assets/source/swiftee-angle-intact-v4.webp')).toString('base64');
    const result = await page.evaluate(async source => {
      const image = new Image(); image.src = 'data:image/webp;base64,' + source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
      const poses = [];
      for (let frame = 0; frame < 8; frame++) {
        const x0 = Math.round(frame % 4 * image.width / 4), y0 = Math.round(Math.floor(frame / 4) * image.height / 2);
        const w = Math.round(image.width / 4), h = Math.round(image.height / 2);
        const gold = new Uint8Array(w*h);
        const left = frame === 5 || frame === 6;
        for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
          if (left ? x>w*.5 : x<w*.53) continue;
          const k=((y0+y)*image.width+x0+x)*4;
          if(pixels[k+3]>100 && pixels[k]>150 && pixels[k+1]>85 && pixels[k+2]<pixels[k+1]*.72) gold[y*w+x]=1;
        }
        const points=[];
        for(let i=0;i<gold.length;i++) if(gold[i]) points.push({x:i%w,y:Math.floor(i/w)});
        const prior=[0,0,94,94,-150,146,-73,0][frame];
        if(points.length<50)throw Error('No protractor rim in frame '+frame);
        // Find the long straight gold baseline, rather than assuming the
        // generator obeyed an exact angle. Reviewed orientation ranges distinguish
        // the baseline from tangents to the curved rim.
        let best={score:0};
        for(let deg=prior-12;deg<=prior+12;deg+=.5) {
          const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a), bins=new Map();
          points.forEach(p=>{const d=Math.round(-s*p.x+c*p.y);bins.set(d,(bins.get(d)||0)+1);});
          for(const d of bins.keys()) {
            let score=0;for(let k=-2;k<=2;k++)score+=bins.get(d+k)||0;
            if(score>best.score)best={score,deg,d,c,s};
          }
        }
        const line=points.filter(p=>Math.abs(-best.s*p.x+best.c*p.y-best.d)<=2.5);
        const projections=line.map(p=>best.c*p.x+best.s*p.y).sort((a,b)=>a-b);
        const runs=[[]];
        projections.forEach((t,i)=>{if(i && t-projections[i-1]>10)runs.push([]);runs[runs.length-1].push(t);});
        runs.sort((a,b)=>(b[b.length-1]-b[0])-(a[a.length-1]-a[0]));
        const baseline=runs[0],mid=(baseline[0]+baseline[baseline.length-1])/2;
        const anchor={x:best.c*mid-best.s*best.d,y:best.s*mid+best.c*best.d};
        let angle=best.deg;
        while(angle>180)angle-=360;
        while(angle<=-180)angle+=360;
        let tx=0,ty=0,count=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
          const k=((y0+y)*image.width+x0+x)*4;
          if(pixels[k+3]>100 && pixels[k+1]-pixels[k]>45 && pixels[k+1]>pixels[k+2]*.97){tx+=x;ty+=y;count++;}
        }
        const body={x:tx/count,y:ty/count};
        poses.push({anchor,angle,body,x0,y0,w,h});
      }
      const left=Math.max(...poses.map(p=>p.anchor.x)),top=Math.max(...poses.map(p=>p.anchor.y));
      const right=Math.max(...poses.map(p=>p.w-p.anchor.x)),bottom=Math.max(...poses.map(p=>p.h-p.anchor.y));
      const cell=Math.ceil(Math.max(left+right+64,top+bottom+64)/64)*64,anchor={x:32+left,y:32+top};
      const atlas=document.createElement('canvas');atlas.width=cell*4;atlas.height=cell*2;
      const out=atlas.getContext('2d');out.imageSmoothingQuality='high';
      poses.forEach((p,i)=>{
        // Entire source cell, including the entire bird and its held tool.
        const dx=i%4*cell+anchor.x-p.anchor.x,dy=Math.floor(i/4)*cell+anchor.y-p.anchor.y;
        if(dx<i%4*cell ||dy<Math.floor(i/4)*cell ||dx+p.w>(i%4+1)*cell ||dy+p.h>(Math.floor(i/4)+1)*cell)throw Error('Insufficient padding '+i);
        out.drawImage(image,p.x0,p.y0,p.w,p.h,dx,dy,p.w,p.h);
      });
      // ONE PIECE PER POSE. The generator's grid leaves slivers of a NEIGHBOURING pose at the
      // edges of some source cells (a gold fleck of another protractor beside his tail, frame 2).
      // Each cell keeps its connected pieces of real size — the bird and the tool he holds are one
      // piece — and anything under 2 % of the largest, with its faint edge, is cleared. The bird
      // itself is never cut: this removes only islands that touch nothing.
      for(let i=0;i<poses.length;i++){
        const ox=i%4*cell, oy=Math.floor(i/4)*cell, img=out.getImageData(ox,oy,cell,cell), d=img.data, n=cell*cell;
        const lab=new Int32Array(n).fill(-1), sizes=[];
        for(let k=0;k<n;k++){
          if(lab[k]>=0||d[k*4+3]<=24)continue;
          const id=sizes.length;sizes.push(0);const stack=[k];lab[k]=id;
          while(stack.length){const q=stack.pop();sizes[id]++;const qx=q%cell,qy=(q/cell)|0;
            for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){const rx=qx+xx,ry=qy+yy;if(rx<0||ry<0||rx>=cell||ry>=cell)continue;const r=ry*cell+rx;if(lab[r]<0&&d[r*4+3]>24){lab[r]=id;stack.push(r);}}}
        }
        const largest=Math.max(...sizes), drop=sizes.map(s=>s<largest*.02);
        if(!drop.some(Boolean))continue;
        for(let k=0;k<n;k++){
          if(lab[k]>=0&&drop[lab[k]]){
            const kx=k%cell,ky=(k/cell)|0;
            for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){const rx=kx+xx,ry=ky+yy;if(rx<0||ry<0||rx>=cell||ry>=cell)continue;const r=ry*cell+rx;
              if(r===k||(lab[r]<0&&d[r*4+3]<=24))d[r*4+3]=0;}
          }
        }
        out.putImageData(img,ox,oy);
      }
      return {png:atlas.toDataURL('image/png').split(',')[1],webp:atlas.toDataURL('image/webp',.94).split(',')[1],poses,cell,anchor};
    }, source);
    fs.writeFileSync(path.join(root,'assets/source/swiftee-angle-intact-v4-packed.png'),Buffer.from(result.png,'base64'));
    fs.writeFileSync(path.join(root,'assets/swiftee/swiftee-angle-intact-v4.webp'),Buffer.from(result.webp,'base64'));
    const spec={image:'assets/swiftee/swiftee-angle-intact-v4.webp',cell:result.cell,cols:4,rows:2,frames:8,anchor:result.anchor,scale:.24,
      poses:result.poses.map(p=>({angle:p.angle,sourceAnchor:p.anchor,bodyOffset:{x:p.body.x-p.anchor.x,y:p.body.y-p.anchor.y}})),carry:0};
    fs.writeFileSync(path.join(root,'assets/swiftee/swiftee-angle-measuring.json'),JSON.stringify(spec,null,2)+'\n');
    fs.writeFileSync(path.join(root,'src/character/angle-measuring-frames.js'),'// Complete generated poses, registered by tools/build-angle-measuring.js\n(function(g){g.AngleMeasuringFrames='+JSON.stringify(spec)+';})(typeof window!=="undefined"?window:globalThis);\n');
    console.log('Packed 8 intact full-body poses:',spec.poses.map(p=>p.angle));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
