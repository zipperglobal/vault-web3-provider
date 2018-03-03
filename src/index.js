var ProviderEngine = require('web3-provider-engine')
var HookedWalletSubprovider = require('web3-provider-engine/subproviders/hooked-wallet.js')
var Web3Subprovider = require("web3-provider-engine/subproviders/web3.js")
var FiltersSubprovider = require('web3-provider-engine/subproviders/filters.js')
var SubscriptionsSubprovider = require('web3-provider-engine/subproviders/subscriptions.js')
var ethutil = require('ethereumjs-util')
var Transaction = require('ethereumjs-tx')
var vault = null
var vaultSecp256k1 = null
var accounts = []

function normalize(hex) {
  if (hex == null) {
    return null
  }
  if (hex.startsWith("0x")) {
    hex = hex.substring(2)
  }
  if (hex.length % 2 != 0) {
    hex = "0" + hex
  }
  return hex
}

function buffer(hex) {
  if (hex == null) {
    return new Buffer('', 'hex')
  } else {
    return new Buffer(normalize(hex), 'hex')
  }
}

/**
 * Converts a secp256k1 signature in hex form into a Ethereum form v,r,s
 * @param {{signature: String, recovery: Number} sig the signature to convert
 * @return {{v: Number, r: String, s: String}} the Ethereum form signature
 */
function toEthSig(sig) {
    var ret = {}
    ret.r = sig.signature.slice(0, 64)
    ret.s = sig.signature.slice(64, 128)
    ret.v = sig.recovery + 27
    return ret
}

/**
 * Converts a Ethereum style signature into secp256k1 form
 * @param {Number} v part of Ethereum style signature, either 27 or 28
 * @param {String} r part of Ethereum style signature, in hex form
 * @param {String} s part of Ethereum style signature, in hex form
 * @return {{String, Number}} secp256k1 signature
 */

function fromEcSig(v,r,s) {
    r = Buffer.from(r, 'hex');
    s = Buffer.from(s, 'hex');
    var signature = Buffer.concat([r, s]);
    var recovery = v - 27
    if (recovery !== 0 && recovery !== 1) {
       throw new Error('Invalid signature v value')
    }
    return { signature: signature.toString('hex'), recovery: recovery }
}

function ethAddress(derive) {
  return new Promise( 
    function (resolve, reject) {
      vaultSecp256k1.keyInfo(vault, derive).then(function(result) {
        resolve(ethutil.bufferToHex(ethutil.pubToAddress("0x" + result.pubkey.slice(2))))
      })
    })
}

exports.addAccount = function(derive) {
   return new Promise(
     function (resolve, reject) { 
       ethAddress(derive).then((result) => {
         accounts.push({'derive': derive, 'address' : result})
         resolve(result)
       })
     })
}

class ZipperProvider extends HookedWalletSubprovider {
  constructor() {
    super({
      getAccounts: function(cb) {
        let tempAccountsList = []
        for (var i = 0; i < accounts.length; i++) {
          tempAccountsList.push(accounts[i].address)
        }
        cb(null, tempAccountsList)
        return
      },
      signTransaction: function(txParams, cb) {
        let from = txParams.from
        let derive = null
        for (var i = 0; i < accounts.length; i++) {
          if (accounts[i].address === from) {
            derive = accounts[i].derive
            break
          }
        }
        if (derive === null) {
          cb('no such account')
          return
        }
        let tx = new Transaction(txParams)
        vaultSecp256k1.sign(vault, derive, tx.hash(false).toString('hex')).then(function(result) { 
          var sig = toEthSig(result)
          sig.r = Buffer.from(sig.r, 'hex')
          sig.s = Buffer.from(sig.s, 'hex')
          if (tx._chainId > 0) {
            sig.v += tx._chainId * 2 + 8
          }
          Object.assign(tx, sig)
          cb(null, '0x' + tx.serialize().toString('hex'))
          return
        })
        return
      }
    })
  }
}

exports.init = function(vaultModule, vaultSecp256k1Module, givenProvider) {
  vault = vaultModule
  vaultSecp256k1 = vaultSecp256k1Module

  var engine = new ProviderEngine()
  engine.addProvider(new ZipperProvider())
  engine.addProvider(new FiltersSubprovider())
  engine.addProvider(new SubscriptionsSubprovider())
  engine.addProvider(new Web3Subprovider(givenProvider))
  engine.start()
  return engine
}
