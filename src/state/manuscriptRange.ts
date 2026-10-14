// A textarea uses LF; imported text can retain CRLF. Store offsets in source units.
export function sourceOffset(text:string,displayOffset:number):number{
 let at=0,count=0;while(at<text.length&&count<displayOffset){if(text[at]==='\r'&&text[at+1]==='\n')at++;at++;count++;}return at;
}
