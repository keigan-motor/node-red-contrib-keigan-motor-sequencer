const KMConnector=require('kmconnector/KMConnectorUSB');
const KMMotorOneUSBSerial=KMConnector.KMMotorOneUSBSerial;
const EventEmitter = require("events");
const sequencerEvent = new EventEmitter();
sequencerEvent.setMaxListeners(50);

sequencerEvent.on("error", (err) => {
    console.error(err);
});

const MSG_TYPE={
    EXE_SUCCESS:{type:0,msg:"success"},
    MOTOR_NOTIFY:{type:10,msg:"Motor Notify"},

    UNEXPECTED_ERR:{type:100,msg:"Unexpected Err"},
    MOTOR_NOTFOUND:{type:101,msg:"Motor NotFound"},
    COMMAND_NOTFOUND:{type:102,msg:"Command NotFound"},
    COMMAND_ERR:{type:103,msg:"Command Err"},
    COMMAND_RES_ERR:{type:104,msg:"Command Result Err"},
    MOTOR_IS_NOT_CONNECTED:{type:105,msg:"Motor is not connected"},
    REGISTER_COMMAND_ERR:{type:106,msg:"Register Command Err"},
    CONNECT_FAILURE:{type:107,msg:"Connect Failure"}
};


/////
module.exports = function(RED) {
    /*-------------------------------
        node red node instance constructor
    -------------------------------*/
    function kmMotorSequencer(config) {
        RED.nodes.createNode(this,config);//instance init
        ////instance///////////////////
        let node = this;
        node.status({});

        try {
            node.cmdJson = JSON.parse(config.cmdJson);
        } catch(e) {
            node.cmdJson=config.cmdJson;
        }
        node.isErrStop=!!config.isErrStop;
        node.isCmdArgsExternalInput=config.isCmdArgsExternalInput;//コマンドの引数のみ外部受付

        node.targetMotor = null;
        /*--------------------------
        // Events
        --------------------------*/
        //接続成功
        node._connectOneLis=function(kMDeviceInfo){
            node._connectRelationsLinserDispose();
            node._comp({cmd:"connect"},kMDeviceInfo.name);

        };
        //接続に失敗
        node._connectFailureOneLis=function(kMDeviceInfo,err){
            node._connectRelationsLinserDispose();
            node._err(MSG_TYPE.CONNECT_FAILURE,{cmd:"connect"},kMDeviceInfo.name)

        };
        //切断された
        node._disconnectOneLis=function(kMDeviceInfo){
            node._connectRelationsLinserDispose();
            node._comp({cmd:"disconnect"},kMDeviceInfo.name);
        };

        //モーターの回転情報
        node._motorMeasurementLis=function(kMRotState){
            node._notify({cmd:"motorMeasurement"},kMRotState.GetValObj());
        };
        //モーターIMU情報受信
        node._imuMeasurementLis=function(kMImuState){
            //info::ジャイロ有効化（kMMotorOneUSB.cmdEnableIMU()）時のみ出力される
            node._notify({cmd:"imuMeasurement"},kMImuState.GetValObj());
        };
        //モーターIMU情報受信
        node._motorLogLis=function(kMMotorLog){
            node._notify({cmd:"motorLog"},kMMotorLog.GetValObj());
        };


        /*--------------------------
        // section::instance Method
        --------------------------*/

        /*--------------------------
        // msgs
        //
        //成功時: msg{payload:true,comp:{},execmd:{"cmd":"cmdRun_rpm","arg":20}}
        //失敗時: msg{payload:false,err:{type:3,msg:"Command Err",info:info},execmd:{"cmd":"cmdRun_rpm","arg":20}}
        //取得時: msg{payload:true,response:{*},execmd:{"cmd":"cmdRun_rpm","arg":20}}
        --------------------------*/
       node._err=function(msgType={},cmdObj={},info=""){
            node.msg.payload=false;
            node.msg.execmd=Object.assign({response:false},cmdObj);
            node.msg.err=Object.assign({info:info}, msgType);
            delete node.msg.comp;

            node.status({fill: "red", shape: "dot", text: msgType.msg+((typeof info==="object")?":"+info.msg:info)});
            node.error(msgType.msg, node.msg);
            if(!node.isErrStop){
                node.send(node.msg);
            }
        };
        node._comp=function(cmdObj={},info="",response=null){
            node.msg.payload=response?response:true;
            node.msg.execmd=Object.assign({response:response},cmdObj);
            node.msg.comp=Object.assign({info:info}, MSG_TYPE.EXE_SUCCESS);
            delete node.msg.err;
            node.status({fill: "green", shape: "dot", text: cmdObj.cmd + (cmdObj.arg?":"+cmdObj.arg:"")+(info?":"+info:"")+(response?">>"+response:"")});
            node.send(node.msg);
        };
        //通知用
        node._notify=function(cmdObj={},response=null){
            node.msg.payload=response;
            node.msg.execmd=Object.assign({response:response},cmdObj);
            node.msg.comp={info:MSG_TYPE.MOTOR_NOTIFY};
            delete node.msg.err;
            node.send(node.msg);
        };

        node._connectRelationsLinserDispose = function () {
            if (node.targetMotor) {
                node.targetMotor.removeListener(node.targetMotor.EVENT_TYPE.connectFailure, node._connectFailureOneLis);
                node.targetMotor.removeListener(node.targetMotor.EVENT_TYPE.connect, node._connectOneLis);
                node.targetMotor.removeListener(node.targetMotor.EVENT_TYPE.disconnect, node._disconnectOneLis);

                node.targetMotor.removeListener(node.targetMotor.EVENT_TYPE.motorMeasurement, node._motorMeasurementLis);
                node.targetMotor.removeListener(node.targetMotor.EVENT_TYPE.imuMeasurement, node._imuMeasurementLis);
                node.targetMotor.removeListener(node.targetMotor.EVENT_TYPE.motorLog, node._motorLogLis);
            }
        };
        node._connectRelationsLinserAdd = function () {
            if (node.targetMotor) {
                node.targetMotor.on(node.targetMotor.EVENT_TYPE.connect, node._connectOneLis);
                node.targetMotor.on(node.targetMotor.EVENT_TYPE.connectFailure, node._connectFailureOneLis);
                node.targetMotor.on(node.targetMotor.EVENT_TYPE.disconnect, node._disconnectOneLis);
            }
        };
        /*--------------------------
        // section::input Method
        // ○info::コマンド種類
        // 接続コマンド connect(void) disConnect(void)
        // 通知 motorMeasurement():(kMRotState)=>{} imuMeasurement():(kMImuState)=>{} motorLog():(kMMotorLog)=>{}
        //
        --------------------------*/
        node.on('input', function(msg) {
            node.msg = msg;
            //info::ノード自体のコマンド設定が"msg.payload"の場合のみ外部コマンド(msg.payload.{"cmd":"hoge","arg",[1,2..]})を受付ける
            let cmdObj = node.cmdJson === "msg.payload" ? msg.payload : node.cmdJson;

            try {
                //モーター参照を伴わない入力処理は一切行わない
                if (typeof msg.motor !== "object" || !msg.motor) {
                    node._err(MSG_TYPE.MOTOR_NOTFOUND,cmdObj);
                    return;
                }
                node._connectRelationsLinserDispose();
                let motors=KMMotorOneUSBSerial.motorsByUUID;
                node.targetMotor = motors[msg.motor.id];
                msg.motor=node.targetMotor.deviceInfo;

                //コマンドの実行
                if (typeof cmdObj !== "object" || !cmdObj.cmd) {
                    node._err(MSG_TYPE.COMMAND_NOTFOUND,cmdObj);
                    return;
                }
                //接続・切断コマンド
                if(cmdObj.cmd==="connect"||cmdObj.cmd==="disConnect"){
                    if (typeof node.targetMotor.connect === 'function') {
                        node._connectRelationsLinserAdd();
                        if (cmdObj.cmd==="connect"){
                            if(!node.targetMotor.deviceInfo.isConnect){
                                let res = node.targetMotor.connect();
                            }else{
                                node._connectOneLis.call(node.targetMotor,node.targetMotor.deviceInfo);
                            }
                        }
                        if (cmdObj.cmd==="disConnect"){
                            if(node.targetMotor.deviceInfo.isConnect){
                                let res = node.targetMotor.disConnect();
                            }else{
                                node._disconnectOneLis.call(node.targetMotor,node.targetMotor.deviceInfo);
                            }
                        }
                    } else {
                        node._err(MSG_TYPE.COMMAND_ERR,cmdObj);
                    }
                }else if(cmdObj.cmd==="onMotorMeasurement"||cmdObj.cmd==="onImuMeasurement"||cmdObj.cmd==="onMotorLog"){
                    //通知コマンド
                    switch(cmdObj.cmd){
                        case"onMotorMeasurement":
                            node.targetMotor.on(node.targetMotor.EVENT_TYPE.motorMeasurement, node._motorMeasurementLis);
                            break;
                        case"onImuMeasurement":
                            node.targetMotor.on(node.targetMotor.EVENT_TYPE.imuMeasurement, node._imuMeasurementLis);
                            break;
                        case"onMotorLog":
                            node.targetMotor.on(node.targetMotor.EVENT_TYPE.motorLog, node._motorLogLis);
                            break;
                    }
                    node.status({fill: "green", shape: "dot", text: cmdObj.cmd});

                }else {
                    //その他コマンド処理
                    if (!node.targetMotor.deviceInfo.isConnect) {
                        node._err(MSG_TYPE.MOTOR_IS_NOT_CONNECTED,cmdObj,node.targetMotor.deviceInfo.name);
                        return;
                    }
                    //全ての関数が実行出来る為、cmdのみに制限を加える
                    else if (cmdObj.cmd.indexOf("cmd") === 0 && (typeof node.targetMotor[cmdObj.cmd]) === 'function') {

                        //info::コマンドの引数が"msg.payload"の場合、コマンドの引数をmsg.payloadから受付
                        let _impArg=(cmdObj.arg&&cmdObj.arg==="msg.payload")?msg.payload:cmdObj.arg;
                        let arg = Array.isArray(_impArg) ? _impArg : (typeof _impArg === "string" ? _impArg.split(',') : [_impArg]);

                        let exeCmd=Object.assign({},cmdObj,{"arg":arg});
                        let res = node.targetMotor[exeCmd.cmd](...exeCmd.arg);
                        //返り値のあるコマンド
                        if(res instanceof Promise){
                            res.then((val) => {
                                node._comp(exeCmd,null,val);
                            }).catch((msg) => {
                                node._err(MSG_TYPE.COMMAND_RES_ERR,exeCmd,msg);
                            });
                        }else{
                            node._comp(exeCmd);
                        }
                        return;
                    } else {
                        node._err(MSG_TYPE.COMMAND_ERR,cmdObj);
                        return;
                    }
                }


            }catch (err){
                node._err(MSG_TYPE.UNEXPECTED_ERR,cmdObj,err.message);
            }

        });

        node.on('close', function() {
            node._connectRelationsLinserDispose();

        });
    }

    ////
    RED.nodes.registerType("km-motor-sequencer",kmMotorSequencer);

};
