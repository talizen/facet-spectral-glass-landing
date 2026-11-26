import { useEffect, useRef } from 'react'
import { mountSpectral, type SpectralHandle, type SpectralOptions } from '../lib/spectral/engine'

/**
 * 玻璃引擎的 React 外壳：挂载时建一次，之后配置变了就 update。
 * replayKey 变化时把时间拨回 0，重放"从中心展开"的开场。
 */
export function SpectralCanvas({
  options,
  replayKey,
  className,
}: {
  options: Partial<SpectralOptions>
  replayKey?: string | number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const handle = useRef<SpectralHandle | null>(null)

  useEffect(() => {
    handle.current = mountSpectral(ref.current!, options)
    return () => {
      handle.current?.dispose()
      handle.current = null
    }
    // 只在挂载时建一次；之后的变化走下面的 update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const key = JSON.stringify(options)
  useEffect(() => {
    handle.current?.update(options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    handle.current?.restart()
  }, [replayKey])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
