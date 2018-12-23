#! /usr/bin/env node

const fs = require('fs')
const parse5 = require('parse5')

const DIR = './tuja-vortaro/revo/src/xml/'

let output = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generated file -->
<d:dictionary xmlns="http://www.w3.org/1999/xhtml" xmlns:d="http://www.apple.com/DTDs/DictionaryService-1.0.rng">
`

let entries = fs.readdirSync(DIR)
let entities = {}
{
  let data = fs.readFileSync(DIR + '../dtd/vokosgn.dtd').toString() +
    fs.readFileSync(DIR + '../dtd/vokomll.dtd').toString()
  let ents = data.match(/<!ENTITY\s+\w+\s+".+?"\s*>/g)

  for (let entity of ents) {
    let match = entity.match(/<!ENTITY\s+(\w+)\s+"(.+?)"\s*>/)
    entities[match[1]] = match[2]
  }

  // resolve entities within entities
  for (let entity in entities) {
    entities[entity] = entities[entity].replace(/&[\w_]+?;/g, m => {
      let rep = entities[m.substring(1, m.length - 1)]
      if (rep) return rep
      return m
    })
  }
}

let tagName = name => x => x.tagName === name
let find = (list, match) => {
  for (let i of list) if (match(i)) return i
}
let findAll = (list, match) => list.filter(match)
let findChildTag = (node, name) => find(node.childNodes, tagName(name))
let findAllChildTags = (node, name) => findAll(node.childNodes, tagName(name))
let getNodeTextRaw = node => {
  if (!node) return ''
  if ('value' in node) return node.value.trim()
  if (node.nodeName.startsWith('#')) return ''
  let text = ''
  for (let childNode of node.childNodes) {
    if ('value' in childNode) text += childNode.value
    else text += getNodeText(childNode)
  }
  return text.trim()
}
let replaceEntities = text => text.replace(/&\w+?;/g, m => {
  let entity = entities[m.substring(1, m.length - 1)] || m
  let hex = entity.match(/&#x([\da-f]+);/i)
  if (hex) {
    let codePoint = parseInt(hex[1], 10)
    if (codePoint >= 0x20) {
      entity = String.fromCodePoint(codePoint)
    }
  }
  return entity
})
let getNodeText = node => replaceEntities(getNodeTextRaw(node))
let sanitize = text => text.replace(/&(?!\w+?;)/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
let attrsToObject = attrs => {
  let obj = {}
  for (let attr of attrs) obj[attr.name] = attr.value
  return obj
}

let combineKap = (word, node) => {
  word = word.trim()
  let original = word

  let before = ''
  let after = ''
  let isBefore = true
  for (let child of node.childNodes) {
    if (child.tagName === 'ofc') continue
    if (child.tagName === 'fnt') continue // TODO: handle
    if (child.tagName === 'tld') isBefore = false
    else {
      if (isBefore) before += getNodeText(child)
      else after += getNodeText(child)
    }
  }

  if (isBefore) return before.split(/\s*,\s*/).filter(x => x.trim()) // no tld

  word = before + word + after

  let variants = [word]
  let vars = findChildTag(node, 'var')
  if (vars) {
    for (let child of vars.childNodes) {
      if (child.nodeName.startsWith('#')) continue
      let variant = combineKap(original, child)[0]
      variant = variant.replace(/^[,\s]*/g, '').replace(/[,\s]*$/g, '')
      variants.push(variant)
    }
  }

  return variants
}

let compileTranslations = node => {
  let translations = {}
  for (let child of node.childNodes) {
    if (child.nodeName.startsWith('#')) continue
    if (!child.tagName.startsWith('trd')) continue
    let attrs = attrsToObject(child.attrs)
    if (!attrs.lng) continue
    let words = []
    if (child.tagName === 'trd') words.push(getNodeText(child))
    else {
      for (let trd of child.childNodes) {
        words.push(getNodeText(trd))
      }
    }
    translations[attrs.lng] = words.filter(x => x && x !== ',')
  }
  return translations
}

let inflect = word => {
  if (word.endsWith('o') || word.endsWith('a')) {
    return [word, word + 'j', word + 'n', word + 'jn']
  }
  if (word.endsWith('e')) {
    return [word, word + 'n']
  }
  if (word.endsWith('i')) {
    let root = word.substring(0, word.length - 1)
    return [word, root + 'as', root + 'is', root + 'os', root + 'u', root + 'us']
  }
  return [word]
}

for (let name of entries) {
  process.stdout.write('\r\x1b[2KConverting ' + name)
  let raw = fs.readFileSync(DIR + name).toString()

  // HACKS
  raw = raw.replace(/<tld\s*\/>/g, '<tld></tld>')

  let data = parse5.parseFragment(raw)
  let vortaro = findChildTag(data, 'vortaro')
  let art = findChildTag(vortaro, 'art')

  let wordRoot = getNodeText(findChildTag(findChildTag(art, 'kap'), 'rad'))
  let derivatives = findAllChildTags(art, 'drv')

  // output += `<d:entry id="${name}" d:title="${wordRoot}">`

  // let content = `<h1>${wordRoot}</h1>`

  for (let derivative of derivatives) {
    let kap = findChildTag(derivative, 'kap')
    let words = combineKap(wordRoot, kap)
    let wordID = attrsToObject(derivative.attrs).mrk;

    output += `<d:entry id="${wordID}" d:title="${words[0].replace(/"/g, "'")}">`

    for (let word of words) {
      word = word.replace(/"/g, '&quot;')
      for (let variant of inflect(word)) {
        output += `<d:index d:value="${variant}" />`
      }
    }

    output += `<h1>${words.join(', ')}</h1>`

    let translations = compileTranslations(derivative)

    if (translations.en) {
      output += `<p class="translations">${translations.en.join(', ')}</p>`
    }

    let sncs = findAllChildTags(derivative, 'snc')
    for (let snc of sncs) {
      let dif = findChildTag(snc, 'dif')

      let compileFnt = fnt => {
        let output = ' <span class="source">'
        for (let childNode of fnt.childNodes) {
          if (childNode.tagName === 'aut') {
            output += `<span class="author">${sanitize(getNodeText(childNode))}</span>`
          } else if (childNode.tagName === 'vrk') {
            output += `<span class="work">${sanitize(getNodeText(childNode))}</span>`
          } else if (childNode.tagName === 'bib') {
            output += `<span class="bib">${sanitize(getNodeText(childNode))}</span>`
          } else if (childNode.tagName === 'lok') {
            output += `<span class="location">${sanitize(getNodeText(childNode))}</span>`
          } else {
            output += sanitize(getNodeText(childNode));
          }
        }
        return output + '</span>'
      }

      let compileEkz = ekz => {
        let output = '<p class="ekz">'
        for (let childNode of ekz.childNodes) {
          // TODO: handle <ind> (e.g. in kat.xml)
          if (childNode.tagName === 'fnt') {
            output += compileFnt(childNode);
            let author = findChildTag(childNode, 'aut');
            let work = findChildTag(childNode, 'vrk');
            let bib = findChildTag(childNode, 'bib');
            let location = findChildTag(childNode, 'lok');
          } else if (['trd', 'trdgrp'].includes(childNode.tagName)) {
            continue
          } else {
            output += sanitize(getNodeText(childNode));
          }
        }
        return output + '</p>'
      }

      if (dif) {
        output += `<p class="dif">`
        for (let childNode of dif.childNodes) {
          if (childNode.tagName === 'ekz') {
            output += compileEkz(childNode);
          } else {
            output += sanitize(getNodeText(childNode));
          }
        }
        output += `</p>`
      }

      for (let group of [snc].concat(findAllChildTags(snc, 'refgrp'))) {
        output += `<ul class="ref-group">`
        for (let ref of findAllChildTags(group, 'ref')) {
          let attrs = attrsToObject(ref.attrs);
          output += `<li>${sanitize(getNodeText(ref))}</li>`
        }
        output += `</ul>`
      }

      let rim = findChildTag(snc, 'rim')
      if (rim) {
        output += `<p class="rim">${sanitize(getNodeText(rim))}</p>`
      }
    }

    output += '</d:entry>'
  }

  // output += content
  // output += '</d:entry>'
}

console.log('\r\x1b[2KDone')

/* for (let i of data) {
  let eo = i[0]
  let en = i[1]
  let id = idify(eo)
  let n = 0
  while (ids.includes(id)) id += '_' + (++n)
  ids.push(id)
  output += `<d:entry id="${id}" d:title="${eo}">
  <d:index d:value="${eo}" />
  <h1>${eo}</h1>
  <p>
    ${en}
  </p>
</d:entry>`
} */

output += `</d:dictionary>`

fs.writeFileSync('ddk/MyDictionary.xml', output)
