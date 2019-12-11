const KMConnector=require('kmconnector/KMConnectorUSB');
const KMMotorOneUSBSerial=KMConnector.KMMotorOneUSBSerial;
const EventEmitter = require("events");
const selectorEvent = new EventEmitter();
selectorEvent.setMaxListeners(50);

selectorEvent.on("error", (err) => {
    console.error(err);
});

const MSG_TYPE={
    EXE_SUCCESS:{type:0,msg:"success"},
    GET_SUCCESS:{type:1,msg:"success"},
    UNEXPECTED_ERR:{type:100,msg:"Unexpected Err"},
    MOTOR_NOTFOUND:{type:101,msg:"Motor NotFound"},
    COMMAND_NOTFOUND:{type:102,msg:"Command NotFound"},
    COMMAND_ERR:{type:103,msg:"Command Err"},
    COMMAND_RES_ERR:{type:104,msg:"Command Result Err"},
    MOTOR_IS_NOT_CONNECTED:{type:105,msg:"Motor is not connected"},
    REGISTER_COMMAND_ERR:{type:106,msg:"Register Command Err"},
    CONNECT_FAILURE:{type:107,msg:"Connect Failure"}
};


/**
 * 指定したモーター名で検索
 * @param motorName 指定する場合:"KM1-S AABBCC" 最初の1つ:"^"
 * @returns {KMMotorOne}
 */
function getMotor(motorName){
    let rmt=null;
    let motors=KMMotorOneUSBSerial.motors;
    switch (motorName){
        case ""://最初に見つけた1つ
        case "^":
            let mtnms=Object.keys(motors);
                if(mtnms.length){
                    rmt=motors[mtnms[0]];
                }
            break;
        default:
            rmt=motors[motorName];
            break;
    }
    return rmt;
}

function getMotorNames(){
    let motorNemes = Object.keys(KMMotorOneUSBSerial.motors);
    return motorNemes;
}

/**
 * ステータス表示用 検出モーター名一覧
 * @param motors
 * @returns {string}
 */
function getStatusMotorNames(motors){
    if(!motors){return "";}
    let names="";
    if(Array.isArray(motors)){
        for(let i=0;i<motors.length;i++){
            names+= " :"+motors[i].name;
        }
    }else{
        names+= " :"+motors.name;
    }
    return names;
}

let is_scan=false;

/**
 * デバイスのスキャン
 * @param {bool}is_initializ 既存のモーターを全て破棄してスキャン(実行中のフローがある場合、そのフローのモーターは全て切断される)
 * @returns {Promise<any>}
 */
function scan(is_initializ=false){
    return new Promise((resolve,reject)=>{
        if(is_scan){
            resolve();
            return;
        }
        is_scan=true;
        console.log("scan exec");
        if(is_initializ){
            selectorEvent.emit("clearMotors");
            KMMotorOneUSBSerial.clearMotors();
        }
        setTimeout(()=>{
            KMMotorOneUSBSerial.startScanToCreateInstance().then((motorsByUUID) => {
                is_scan=false;
                selectorEvent.emit("discover");
                selectorEvent.emit("scanTimeout");
                resolve();
            }).catch((err) => {
                is_scan=false;
                console.log(err);
                reject();
            });
        },20);
    });
}

////////
module.exports = function(RED) {
    /*-------------------------------
    // node constructor
    -------------------------------*/
    function kmMotorUsbSelector(config) {
        RED.nodes.createNode(this, config);

        let node = this;
        node._assignedConnectFailureOneLis = () => {
        };
        node._assignedConnectOneLis = () => {
        };
        node._assignedDisconnectOneLis = () => {
        };

        //config
        node.selectMotorName = typeof config.selectMotorName === "string" ? config.selectMotorName : "";
        node.isErrStop = !!config.isErrStop;
        node.isInitializScan = !!config.isInitializScan;
        node.isMotorKeepalive = !!config.isMotorKeepalive;

        node.targetMotor = null;
        node.status({});
        /*--------------------------
        // section::Events
        --------------------------*/
        node._discoverLis = function () {
            let motorNemes = Object.keys(KMMotorOneUSBSerial.motors);
            if (motorNemes.length) {
                node.status({fill: "green", shape: "ring", text: "Discover:[" + motorNemes.join("] [") + "]"});
            } else {
                node.status({});
            }
        };
        selectorEvent.on('discover', node._discoverLis);

        node._clearMotorsLis = function () {
            node._allMotorLinserDispose(node.targetMotor);
            node._ClearKeepaliveConnection();
        };
        selectorEvent.on('clearMotors', node._clearMotorsLis);

        node._connectMonitorLis = function (kMDeviceInfo) {
            node.status({fill: "green", shape: "dot", text: "CONNECT:" + node.targetMotor.name});
        };
        node._disconnectMonitorLis = function (kMDeviceInfo) {
            node.status({fill: "red", shape: "dot", text: "DISCON:" + node.targetMotor.name});
            if (node.isMotorKeepalive) {
                node._KeepaliveConnection();
            }
        };

        /*--------------------------
        // section::instance Method
        --------------------------*/

        node._KeepaliveConnectionTimeoutID = 0;
        node._ClearKeepaliveConnection = function () {
            clearTimeout(node._KeepaliveConnectionTimeoutID);
        };
        node._KeepaliveConnection = function () {
            node._ClearKeepaliveConnection();
            node._KeepaliveConnectionTimeoutID = setTimeout(() => {
                if (node.targetMotor) {
                    node._motorConnect(node.targetMotor).then(() => {
                        node.warn("MotorKeepalive Comp" + node.targetMotor.name);
                    }).catch(err => {
                        node.status({
                            fill: "yellow",
                            shape: "dot",
                            text: "MotorKeepalive try:" + node.targetMotor.name
                        });
                        node.warn("MotorKeepalive try" + node.targetMotor.name, err);
                        node._KeepaliveConnection();
                    });
                }
            }, 1000);
        };


        node._allMotorLinserDispose = function (targetMotor) {
            if (targetMotor) {
                targetMotor.removeListener(targetMotor.EVENT_TYPE.connect, node._connectMonitorLis);
                targetMotor.removeListener(targetMotor.EVENT_TYPE.disconnect, node._disconnectMonitorLis);
                targetMotor.removeListener(targetMotor.EVENT_TYPE.connect, node._assignedConnectOneLis);
                targetMotor.removeListener(targetMotor.EVENT_TYPE.connectFailure, node._assignedConnectFailureOneLis);
            }
        };
        node._err = function (msgType = {}, cmdObj = {}, info = "") {
            node.msg.payload = false;
            node.msg.execmd = Object.assign({}, cmdObj);
            node.msg.err = Object.assign({info: info}, msgType);

            node.status({
                fill: "red",
                shape: "dot",
                text: msgType.msg + ((typeof info === "object") ? ":" + info.msg : info)
            });
            node.error(msgType.msg, node.msg);
            if (!node.isErrStop) {
                node.send(node.msg);
            }
        };
        node._comp = function (cmdObj = {}, info = "") {
            node.msg.payload = true;
            node.msg.execmd = Object.assign({}, cmdObj);
            node.msg.comp = Object.assign({info: info}, MSG_TYPE.EXE_SUCCESS);

            node.status({fill: "green", shape: "dot", text: ((typeof info === "object") ? ":" + info.msg : info)});
            node.send(node.msg);
        };
        /**
         * モーターの接続（接続済みはそのままresolveになる）
         * @param targetMotor
         * @returns {Promise<any>}
         * @private
         */
        node._motorConnect = function (targetMotor) {
            //todo::他のインスタンスノードとの並列処理(接続処理が重複する場合)も考慮する
            return new Promise((resolve, reject) => {
                if (typeof targetMotor === 'object' && typeof targetMotor.connect === 'function') {
                    targetMotor.removeListener(targetMotor.EVENT_TYPE.connect, node._connectMonitorLis);
                    targetMotor.removeListener(targetMotor.EVENT_TYPE.disconnect, node._disconnectMonitorLis);
                    targetMotor.on(targetMotor.EVENT_TYPE.connect, node._connectMonitorLis);
                    targetMotor.on(targetMotor.EVENT_TYPE.disconnect, node._disconnectMonitorLis);

                    if (!targetMotor.deviceInfo.isConnect) {
                        targetMotor.removeListener(targetMotor.EVENT_TYPE.connect, node._assignedConnectOneLis);
                        targetMotor.removeListener(targetMotor.EVENT_TYPE.connectFailure, node._assignedConnectFailureOneLis);

                        targetMotor.once(targetMotor.EVENT_TYPE.connect,
                            node._assignedConnectOneLis = (kMDeviceInfo) => {
                                targetMotor.removeListener(targetMotor.EVENT_TYPE.connectFailure, node._assignedConnectFailureOneLis);
                                resolve(true);
                            });
                        targetMotor.once(targetMotor.EVENT_TYPE.connectFailure,
                            node._assignedConnectFailureOneLis = (kMDeviceInfo, err) => {
                                targetMotor.removeListener(targetMotor.EVENT_TYPE.connect, node._assignedConnectOneLis);
                                reject(err);
                            });
                        let res = targetMotor.connect();
                    } else {
                        resolve(targetMotor);
                    }
                } else {
                    reject(false);
                }
            });
        };

        /**
         * ターゲットモーターの取得
         * ターゲットはnode.selectMotorNameが最優先
         * selectMotorNameがある場合はmsg._selectMotorNameがあっても全てnode.selectMotorNameにoverrideされる
         * msg.payload.{"selectMotorName":"KM1=U XXXX"}
         */
        node.getTargetMotorSelectExec = function () {
            let _srcMotorName = "";
            if (node.selectMotorName.length) {
                _srcMotorName = node.selectMotorName;
            } else if (typeof node.msg.payload === "object" && typeof node.msg.payload.selectMotorName === "string") {
                _srcMotorName = node.msg.payload.selectMotorName;
            }
            let _targetMotor = getMotor(_srcMotorName);

            //モーターが同じノード上で入れ替えられた場合前のモーターのイベントを破棄する
            if (node.targetMotor && _targetMotor && node.targetMotor !== _targetMotor) {
                node._allMotorLinserDispose(node.targetMotor);
            }
            node.targetMotor = _targetMotor;

            if (node.targetMotor) {
                node.msg.motor = node.targetMotor.deviceInfo;//次のnodeに渡すmotor (deviceInfo)
                node._motorConnect(node.targetMotor).then(() => {
                    node._comp({"selectMotorName": _srcMotorName}, node.targetMotor.name);
                }).catch(err => {
                    node._err(MSG_TYPE.CONNECT_FAILURE, {"selectMotorName": _srcMotorName}, {msg: err.name, err: err});
                });
            } else {
                node.msg.motor = null;
                node._err(MSG_TYPE.MOTOR_NOTFOUND, {"selectMotorName": _srcMotorName}, _srcMotorName);
            }
        };

        /*--------------------------
        // section::input Method
        --------------------------*/
        /**
         * 引数 msg.payload
         * info::通常スキャン payload.{"scan":false}
         * info::選択するモーターの指定　payload.{"selectMotorName":<モーター名>}
         *          <モーター名> "^":最初に見つかった物の1つ(デフォルト)
         *                      "KM1-S AABBCC"
         *      ex)msg.payload.{"selectMotorName":"KM1-S AABBCC"}
         *         msg.payload.{"selectMotorName":"^"}
         *         msg.payload.{"scan":true,"selectMotorName":"KM-1U P4NO"} //強制スキャン&モータ指定
         */
        this.on('input', function (msg) {
            node.msg = msg;
            if (!node.msg.payload) {
                return;
            }
            try {
                if (node.msg.payload === "scan") {
                    scan(node.isInitializScan).then(() => {
                        node.getTargetMotorSelectExec();
                    });
                } else if (typeof node.msg.payload === "object" && node.msg.payload.hasOwnProperty('scan')) {
                    scan(Boolean(node.msg.payload.scan)).then(() => {
                        node.getTargetMotorSelectExec();
                    });
                } else {
                    node.getTargetMotorSelectExec();
                }
            } catch (err) {
                node._err(MSG_TYPE.UNEXPECTED_ERR, {payload: node.msg.payload}, err.message);
            }
        });

        this.on('close', function () {
            selectorEvent.removeListener('discover', node._discoverLis);
            selectorEvent.removeListener('clearMotors', node._clearMotorsLis);
            node._allMotorLinserDispose(node.targetMotor);
        });

        node._discoverLis(); //default status
        setTimeout(()=>{
            scan(true).then(() => {});
        },100);
    }

    RED.nodes.registerType("km-motor-usb-selector", kmMotorUsbSelector);

    //スキャンしたモーターをUIに表示
    RED.httpAdmin.get(
        '/__km-motor-usb-list/:id/:is_initializ',
        RED.auth.needsPermission('km-motor-usb-selecto.read'), (req, res) => {
            let node = RED.nodes.getNode(req.params.id);
            let is_initializ = !!req.params.is_initializ;
            scan(is_initializ).then(() => {
                let names= getMotorNames();
                res.json(names);
            }).catch(e => {
                node.error(e);
                res.json([]);
            });
    });

    // RED.events.on('runtime-event', (ev) => {
    //     if (ev.id === 'runtime-state') {
    //         scan(true).then(() => {
    //         }).catch(e => {
    //             node.error(e);
    //         });
    //     }
    // });
};

