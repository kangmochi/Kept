import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const TEXT_ID = 1
const TEXT_NAME = 'kept'
const LIST_ID = 2
const LIST_NAME = 'promises'

function textPage(content: string, capture: 0 | 1, height = 288, y = 0): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: y,
    width: 576,
    height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 8,
    containerID: TEXT_ID,
    containerName: TEXT_NAME,
    content,
    isEventCapture: capture,
  })
}

export function createDisplay(bridge: EvenAppBridge) {
  let layout: 'text' | 'list' = 'text'
  let chain: Promise<void> = Promise.resolve()
  let lastText = ''

  function enqueue(job: () => Promise<void>): Promise<void> {
    chain = chain.then(job, job)
    return chain
  }

  return {
    async boot(content: string): Promise<void> {
      const created = await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [textPage(content, 1)],
        }),
      )
      if (created !== StartUpPageCreateResult.success) {
        throw new Error(`createStartUpPageContainer failed: ${created}`)
      }
      layout = 'text'
      lastText = content
    },

    showText(content: string): Promise<void> {
      return enqueue(async () => {
        if (layout === 'text') {
          if (content === lastText) return
          const ok = await bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: TEXT_ID,
              containerName: TEXT_NAME,
              content,
            }),
          )
          if (!ok) throw new Error('textContainerUpgrade failed')
          lastText = content
          return
        }
        const ok = await bridge.rebuildPageContainer(
          new RebuildPageContainer({
            containerTotalNum: 1,
            textObject: [textPage(content, 1)],
          }),
        )
        if (!ok) throw new Error('rebuildPageContainer failed')
        layout = 'text'
        lastText = content
      })
    },

    showList(header: string, items: string[]): Promise<void> {
      return enqueue(async () => {
        const names = items.slice(0, 20).map((item) => item.slice(0, 63))
        const ok = await bridge.rebuildPageContainer(
          new RebuildPageContainer({
            containerTotalNum: 2,
            textObject: [textPage(header, 0, 56, 0)],
            listObject: [
              new ListContainerProperty({
                xPosition: 0,
                yPosition: 56,
                width: 576,
                height: 232,
                borderWidth: 0,
                borderColor: 0,
                paddingLength: 2,
                containerID: LIST_ID,
                containerName: LIST_NAME,
                isEventCapture: 1,
                itemContainer: new ListItemContainerProperty({
                  itemCount: names.length,
                  itemName: names,
                  itemWidth: 560,
                  isItemSelectBorderEn: 1,
                }),
              }),
            ],
          }),
        )
        if (!ok) throw new Error('rebuildPageContainer failed')
        layout = 'list'
        lastText = ''
      })
    },
  }
}
