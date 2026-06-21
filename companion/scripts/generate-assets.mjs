import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const companionDirectory = path.resolve(scriptDirectory, '..')
const repositoryDirectory = path.resolve(companionDirectory, '..')
const generatedDirectory = path.join(companionDirectory, 'generated')

const iconSources = [
  path.join(repositoryDirectory, 'frontend', 'public', 'favicon.png'),
  path.join(repositoryDirectory, 'frontend', 'public', 'pwa-icon-192.png'),
]

await fs.mkdir(generatedDirectory, { recursive: true })
await fs.copyFile(iconSources[0], path.join(generatedDirectory, 'tray.png'))
await fs.writeFile(
  path.join(generatedDirectory, 'jena-companion.ico'),
  await createIco(iconSources),
)

async function createIco(sourcePaths) {
  const images = await Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const data = await fs.readFile(sourcePath)
      const dimensions = readPngDimensions(data, sourcePath)

      return {
        data,
        ...dimensions,
      }
    }),
  )

  const headerSize = 6
  const entrySize = 16
  const directorySize = headerSize + entrySize * images.length
  const imageDataSize = images.reduce((total, image) => total + image.data.length, 0)
  const output = Buffer.alloc(directorySize + imageDataSize)

  output.writeUInt16LE(0, 0)
  output.writeUInt16LE(1, 2)
  output.writeUInt16LE(images.length, 4)

  let imageOffset = directorySize
  images.forEach((image, index) => {
    const entryOffset = headerSize + entrySize * index

    output.writeUInt8(toIcoDimensionByte(image.width), entryOffset)
    output.writeUInt8(toIcoDimensionByte(image.height), entryOffset + 1)
    output.writeUInt8(0, entryOffset + 2)
    output.writeUInt8(0, entryOffset + 3)
    output.writeUInt16LE(1, entryOffset + 4)
    output.writeUInt16LE(32, entryOffset + 6)
    output.writeUInt32LE(image.data.length, entryOffset + 8)
    output.writeUInt32LE(imageOffset, entryOffset + 12)
    image.data.copy(output, imageOffset)
    imageOffset += image.data.length
  })

  return output
}

function readPngDimensions(data, sourcePath) {
  const signature = data.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`${sourcePath} is not a PNG file.`)
  }

  return {
    height: data.readUInt32BE(20),
    width: data.readUInt32BE(16),
  }
}

function toIcoDimensionByte(value) {
  if (value < 1 || value > 256) {
    throw new Error(`ICO image dimensions must be 1-256 pixels; got ${value}.`)
  }

  return value === 256 ? 0 : value
}
