export function modelConnection(connection,request={}){
 if(!connection)return connection;
 const model=request.model||connection.primaryModel||connection.model;
 return {...connection,model,reviewModel:request.reviewModel||connection.reviewModel||connection.primaryModel||model};
}
