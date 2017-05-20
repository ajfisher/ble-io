var util = require('util'),
  BoardIO = require('board-io'),
  debug = require('debug')('bleio'),
  noble = require('noble');

var DEFAULT_SERVICE = 'bada5555e91f1337a49b8675309fb099';
var DEFAULT_DIGITAL_CHARACTERISTIC = '2a56';
var DEFAULT_ANALOG_CHARACTERISTIC = '2a58';
var DEFAULT_CONFIG_CHARACTERISTIC = '2a59';

//from firmata
var REPORT_ANALOG = 0xC0;
var REPORT_DIGITAL = 0xD0;
var SAMPLING_INTERVAL = 0x7A;
var PIN_MODE = 0xF4;

function lowByte(b){
  return b & 0xFF;
}
function highByte(b){
  return (b >> 8) & 0xFF;
}

function smashBytes(lsb, msb){
  return (lsb & 0xFF) + ((msb & 0xFF) << 8);
}

function compareUUIDs(a, b){
  a = a || '';
  b = b || '';
  a = a.toLowerCase().replace(/\-/g, '');
  b = b.toLowerCase().replace(/\-/g, '');
  return  b.indexOf(a) >= 0;
}

function BLEIO(options) {
  // call super constructor
  BoardIO.call(this);

  options = options || {};

  this._pins = options.pins || [];

  this.serviceId = options.serviceId || DEFAULT_SERVICE;

  this.digitalCharacteristicId = options.digitalCharacteristicId || DEFAULT_DIGITAL_CHARACTERISTIC;
  this.analogCharacteristicId = options.analogCharacteristicId || DEFAULT_ANALOG_CHARACTERISTIC;
  this.configCharacteristicId = options.configCharacteristicId || DEFAULT_CONFIG_CHARACTERISTIC;
  this.peripheral = options.peripheral;

  // .. configure pins
  //this._pins.push(..);

  var self = this;

  if(!this.peripheral){

    debug('startScanning');
    noble.on('stateChange', function(state) {
      debug('state', state);
      if (state === 'poweredOn'){
        noble.startScanning([self.serviceId], false);
      }else{
        noble.stopScanning();
      }
    });




    noble.on('discover', function(peripheral) {
    // we found a peripheral, stop scanning
      noble.stopScanning();

      self.peripheral = peripheral;
      //
      // The advertisment data contains a name, power level (if available),
      // certain advertised service uuids, as well as manufacturer data,
      // which could be formatted as an iBeacon.
      //
      debug('found peripheral:', self.peripheral.advertisement);

      //
      // Once the peripheral has been discovered, then connect to it.
      // It can also be constructed if the uuid is already known.
      ///
      self.peripheral.connect(function(err) {

        debug('connected', err);
        self.emit("connect");

        //
        // Once the peripheral has been connected, then discover the
        // services and characteristics of interest.
        //
        self.peripheral.discoverServices([], function(err, services) {
          debug('discoverServices', err, services);
          services.forEach(function(service) {
            debug('found service', service);


            //
            // So, discover its characteristics.
            //
            service.discoverCharacteristics([], function(err, characteristics) {

              debug('found characteristics', err, characteristics);
              var charCount = 0;
              function incChar(){
                charCount++
                if(charCount === 3){
                  self.emit('ready');
                }
              }

              characteristics.forEach(function(characteristic) {
                //
                // Loop through each characteristic and match them to the
                // UUIDs that we know about.
                //
                debug('found characteristic:', characteristic.uuid);

                if (compareUUIDs(self.digitalCharacteristicId, characteristic.uuid)) {
                  self.digitalChar = characteristic;
                  self.digitalChar.on('read', function(data, isNotification) {
                    debug('digitalNotify', data, isNotification);
                    self.emit('digitalNotify', data);
                  });
                  incChar();
                  self.digitalChar.on('read', function(data, isNotification) {
                    debug('digitalNotify', data, isNotification);
                    self.emit('digital-read-' + data[0], smashBytes(data[1],data[2]));
                  });
                  self.digitalChar.subscribe(function(err){
                    if(err){
                      return debug('error subscribing to digitalChar', err);
                    }
                    debug('subscribed to digitalChar');
                  });
                }
                else if (compareUUIDs(self.analogCharacteristicId, characteristic.uuid)) {
                  self.analogChar = characteristic;
                  self.analogChar.on('read', function(data, isNotification) {
                    debug('analogNotify', data, isNotification);
                    self.emit('analog-read-' + data[0], smashBytes(data[1],data[2]));
                  });
                  self.analogChar.subscribe(function(err){
                    if(err){
                      return debug('error subscribing to analogChar', err);
                    }
                    debug('subscribed to analogChar');
                  });
                  incChar();
                }
                else if (compareUUIDs(self.configCharacteristicId, characteristic.uuid)){
                  self.configChar = characteristic;
                  incChar();
                }
              });

            });



          });
        });

      });

    });


  }
  else{
    //TODO do rx/tx stuff on the passed in peripheral
  }

}
util.inherits(BLEIO, BoardIO);

BLEIO.prototype.setSamplingInterval = function (interval) {
  debug('setSamplingInterval to', interval);
  if(interval > 255){
    return this.configChar.write(new Buffer([SAMPLING_INTERVAL, lowByte(interval), highByte(interval)]),true);
  }
  this.configChar.write(new Buffer([SAMPLING_INTERVAL, interval]),true);
}

BLEIO.prototype.pwmWrite = function(pin, value) {
  this.analogChar.write(new Buffer([pin, lowByte(value), highByte(value)]),true);
};

BLEIO.prototype.analogWrite = BLEIO.prototype.pwmWrite;

BLEIO.prototype.digitalWrite = function(pin, value) {
  this.digitalChar.write(new Buffer([pin, value]),true);
};


BLEIO.prototype.digitalRead = function(pin, callback) {
  this.reportDigitalPin(pin, 1);
  this.addListener("digital-read-" + pin, callback);
};

BLEIO.prototype.reportDigitalPin = function(pin, value) {
  var port = pin >> 3;
  if (value === 0 || value === 1) {
    // TODO track this state?
    // this.pins[pin].report = value;
    this.configChar.write(new Buffer([REPORT_DIGITAL, pin, value]),true);
  }
};

BLEIO.prototype.analogRead = function(pin, callback) {
  this.reportAnalogPin(pin, 1);
  this.addListener("analog-read-" + pin, callback);
};

BLEIO.prototype.reportAnalogPin = function(pin, value) {
  if (value === 0 || value === 1) {
    // TODO track this?
    // this.pins[this.analogPins[pin]].report = value;
    this.configChar.write(new Buffer([REPORT_ANALOG, pin, value]),true);
  }
}

module.exports = BLEIO;
