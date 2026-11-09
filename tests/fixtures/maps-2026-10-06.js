// Maps bundle excerpt, English build 5-0oPufhjKw, 6 October 2026.
// English labels use a plain space before "(" where other builds use a
// no-break space. The Reviews tab button reads "More reviews (N)"; the overview
// button reads "See more reviews (N)". Both share the same gate.
_.EW=function(a){return _.I(a,4)};
r2e=function(a,b){b.H(a.host,{click:c=>void a.actions.kD.run({flow:c})})};s2e=function(a){a.host.Na(`${a.H}.reviewChart.moreReviews`,"click",a,b=>{if(_.EW(_.Dh())&&_.I(a.model.La,259)&&a.actions.tP){let c=a.model.La.ob();a.actions.tP.run({flow:b,Jb:c})}else a.actions.kD.run({flow:b})})};
d.has(4)&&a.H.set(4,{label:"Reviews",ariaLabel:"Reviews for "+e,action:(f,g)=>{a.actions.kD.run({flow:g,hja:!1})},vF:c++,Pa:_.q.ka.Prb});
e=`See more reviews (${_.x1.format(f)})`;d.Bc(_.fN(this,this.Ab,b,{mha:e}));
G0e=function(a,b,c){b.cw||c.H(a.host,{click:d=>{if(_.EW(_.Dh())&&_.I(b.La,259)&&a.actions.tP){let e=b.La.ob();a.actions.tP.run({flow:d,Jb:e})}else a.actions.kD.run({flow:d})}})};
var f=e>0?`More reviews (${_.x1.format(e)})`:"More reviews";
