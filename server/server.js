const express =require('express');
const http = require('http');
const WebSocket = require('ws');

const port = 8100;
const  server = http.createServer(express);
const wss = new WebSocket.Server({ server })
/*
Signal envoyé vers le client:

room-close
join-ok
login-ok
error
peer-list
peer-join

 */
let listRoom=[];
/*
room (string):{
    instance (int/string):{
        'host': (string (ws.params.peerID)),
        'start': (bool),
        'private':(bool),
    }
}
 */
let listRoomPublic=[];
/*
0:'room;instance'
1:...
2:...
 */


wss.on('connection',function connection(ws){
    console.log('new client connected');
    ws.params=[];
    ws.params.peerID=generePeerID();

    ws.on('close', ()=>{
        if(isDefined(ws.params.room) && isDefined(ws.params.instance)){
            if(isHostOfRoom(ws.params.peerID,ws.params.room,ws.params.instance)){ //Host quite la room
                removeRoom(ws.params.room,ws.params.instance);
            }else{
                wss.clients.forEach(function each(client){
                    if (client.readyState === WebSocket.OPEN && client.params.room===ws.params.room && client.params.instance===ws.params.instance) {
                        if(client !== ws) {
                            client.send(JSON.stringify({
                                'signal':'peer-left',
                                'peerID':ws.params.peerID,
                                'alias':ws.params.alias,
                            }));
                        }
                    }
                })
            }
        }
        let msg='client disconnected';
        if(isDefined(ws.params.alias)){
            msg+=' (alias : '+ws.params.alias+')'
        }
        console.log(msg);
        delete ws.params
    })
    ws.on('message', function incoming(data){
        let isJSON,dataJson={};
        try {
            dataJson = JSON.parse(data);
            isJSON = true;
        } catch (e) {
            isJSON = false;
        }
        if(isJSON){
            switch(dataJson.signal){
                case "debug1":
                    console.log(listRoomPublic);
                    ws.send(JSON.stringify(listRoom));
                    break;
                case "room-list":
                    ws.send(JSON.stringify({"signal":"room-list","data":listRoomPublic}));
                    break;
                case "login":
                    try {
                        if (typeof dataJson.alias !== "undefined") {
                            let alias = getValidAlias(wss, dataJson.alias);
                            ws.params.alias = alias;
                            ws.send(JSON.stringify({
                                'signal': 'login-ok',
                                'peerID':ws.params.peerID,
                                'alias': alias
                            }));
                        } else {
                            throw new SyntaxError('invalid alias');
                        }
                    }catch (e) {
                        signallingError(ws,e.message);
                    }
                    break;
                case "join":
                    try{
                        if(!isDefined(ws.params.alias)){
                            throw new SyntaxError('You need to be logged before join a room');
                        }
                        if(isDefined(ws.params.alias) && isDefined(dataJson.room) && isDefined(dataJson.instance)){
                            if(!isDefined(ws.params.room) && !isDefined(ws.params.instance)){
                                ws.params.room=dataJson.room;
                                ws.params.instance=dataJson.instance;
                                let isHost=newRoom(dataJson.room, dataJson.instance, ws.params.peerID, false, false);
                                ws.send(JSON.stringify({
                                    'signal':'join-ok',
                                    'room':dataJson.room,
                                    'instance':dataJson.instance,
                                    'isHost':isHost,
                                }));
                                let peerlist=[];
                                wss.clients.forEach(function each(client) {
                                    if (client.readyState === WebSocket.OPEN && client.params.room===ws.params.room && client.params.instance===ws.params.instance) {
                                        if(client !== ws) {
                                            peerlist=peerlist.concat({
                                                'peerID':client.params.peerID,
                                                'alias':client.params.alias,
                                            })
                                            client.send(JSON.stringify({
                                                'signal':'peer-join',
                                                'peerID':ws.params.peerID,
                                                'alias':ws.params.alias,
                                            }));
                                        }
                                    }
                                })
                                ws.send(JSON.stringify({
                                    'signal':'peer-list',
                                    'list':peerlist,
                                    'length':peerlist.length
                                }));
                            }else{
                                throw new SyntaxError('Already in room');
                            }
                        }else{
                            throw new SyntaxError('Error on join room');
                        }
                    }catch (e) {
                        signallingError(ws,e.message);
                    }
                    break;
                case 'left':
                    if(isDefined(ws.params.room) && isDefined(ws.params.instance)){
                        if(isHostOfRoom(ws.params.peerID,ws.params.room,ws.params.instance)){ //Host quite la room
                            removeRoom(ws.params.room,ws.params.instance);
                        }else{
                            wss.clients.forEach(function each(client){
                                if (client.readyState === WebSocket.OPEN && client.params.room===ws.params.room && client.params.instance===ws.params.instance) {
                                    if(client !== ws) {
                                        client.send(JSON.stringify({
                                            'signal':'peer-left',
                                            'peerID':ws.params.peerID,
                                            'alias':ws.params.alias,
                                        }));
                                    }
                                }
                            })
                        }
                        delete ws.params.room;
                        delete ws.params.instance;
                        ws.send(JSON.stringify({
                            'signal':'left-ok',
                        }));
                    }else{
                        signallingError(ws,"You are not in room");
                    }
                    break;
                default:
                    if(isDefined(ws.params.room) && isDefined(ws.params.instance)) {
                        wss.clients.forEach(function each(client) {
                            if (client.readyState === WebSocket.OPEN && client.params.room===ws.params.room && client.params.instance===ws.params.instance) {
                                dataJson.peer = ws.params.peerID;
                                if(client !== ws) {
                                    client.send(JSON.stringify(dataJson));
                                }else{
                                    if(dataJson.return===true){
                                        client.send(JSON.stringify(dataJson));
                                    }
                                }
                            }
                        })
                    }
                    break;
            }
            return true;
        }
    })
})
function signallingError(ws,detail){
    ws.send(JSON.stringify({
        'signal':'error',
        'details':detail
    }));
}

function generePeerID(){
    var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var string_length = 4;
    var randomstring = '';
    for (var i=0; i<string_length; i++) {
        var rnum = Math.floor(Math.random() * chars.length);
        randomstring += chars.substring(rnum,rnum+1);
    }
    return randomstring;
}

function isHostOfRoom(peerID,room,instance=0){
    return (listRoom[room][instance].host === peerID)
}

function newRoom(room, instance, host, privateRoom=false, start=false){
    if(typeof listRoom[room]==="undefined"){
        listRoom[room]=[];
    }
    if(typeof listRoom[room][instance]==="undefined"){
        if(typeof listRoom[room] === "undefined") {
            listRoom[room] = [];
        }
        if(typeof listRoom[room][instance]==="undefined"){
            listRoom[room][instance] = {
                'host': host,
                'private':privateRoom,
                'start': start,
            };
        }
        if(!privateRoom){
            listRoomPublic.push(room+';'+instance);
        }
        return true;
    }
    return false;
}

function removeRoom(room,instance){
    if(typeof listRoom[room][instance]!=="undefined") {
        wss.clients.forEach(function each(client) {
            if (client.readyState === WebSocket.OPEN && client.params.room===room && client.params.instance===instance) {
                client.send(JSON.stringify({
                    'signal':'room-close',
                    'details':"Host has left the room",
                    'status':'1',
                }));
                delete client.params.room;
                delete client.params.instance;
            }
        })
        delete listRoom[room][instance];
        if(Object.values(listRoom[room]).length===0){
            delete listRoom[room];
        }
        for(let i=0,l=listRoomPublic.length;i<l;i++){
            if(listRoomPublic[i]===room+';'+instance){
                listRoomPublic.splice(i,1);
                break;
            }
        }
    }
}

function isDefined(variable){
    return !(typeof variable === 'undefined' || variable === '');
}

function getValidAlias(wss,alias,number=''){
    let validAlias=alias+number;
    wss.clients.forEach(function each(client){
        if(client.params.alias === validAlias){
            if(number===''){number=2}
            else{number++}
            validAlias=getValidAlias(wss,alias,number);
            return validAlias;
        }
    })
    return validAlias;
}

server.listen(port,function(){
    console.log(`Server2 is listen on ${port}`)
})
