# KeiganMotor node module for Node-RED on RaspberryPi

RaspberryPiにUSB接続したKeiganMotorをNode-REDから操作するノード。

![sc_1](/sc_1.png)

## 前提条件
raspberry pi3 又はraspberry pi4
node-red v1.0以上

## インストール 

+ パレットの管理からインストール  
    [パレットの管理]>[ノードを追加]>"node-red-contrib-keigan-motor-sequencer"で検索
    
+ npmからインストール場合  
    Node-REDのROOT(.node-red)ディレクトリで以下を実行

```
 $npm install node-red-contrib-keigan-motor-sequencer
 ```
 

## 依存関係
- [kmconnector](https://github.com/keigan-motor/kmconnector-js)

## サンプル
　サンプルはsampleFlow.jsonをフローに読み込んで下さい

