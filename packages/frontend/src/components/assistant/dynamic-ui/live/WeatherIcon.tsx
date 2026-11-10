import { useId, type ReactNode } from 'react';
import type { UiWeatherIcon } from '@plum-code-webui/shared';

/* A small, colourful icon set for the 16 weather keys; readable on light and dark. */
const CLOUD = 'M17 47h29a10.5 10.5 0 0 0 .9-20.96A14.5 14.5 0 0 0 19.3 29.6 8.75 8.75 0 0 0 17 47Z';

function Sun({
  id,
  x = 32,
  y = 32,
  r = 11,
  rays = true,
}: {
  id: string;
  x?: number;
  y?: number;
  r?: number;
  rays?: boolean;
}) {
  return (
    <g>
      {rays && (
        <g stroke="#F6B53B" strokeWidth={3} strokeLinecap="round">
          {Array.from({ length: 8 }, (_, index) => {
            const angle = (index * Math.PI) / 4;
            const inner = r + 4.5;
            const outer = r + 9;
            return (
              <line
                key={index}
                x1={x + Math.cos(angle) * inner}
                y1={y + Math.sin(angle) * inner}
                x2={x + Math.cos(angle) * outer}
                y2={y + Math.sin(angle) * outer}
              />
            );
          })}
        </g>
      )}
      <circle cx={x} cy={y} r={r} fill={`url(#${id}-sun)`} />
    </g>
  );
}
function Moon({ id, x = 32, y = 32, r = 14 }: { id: string; x?: number; y?: number; r?: number }) {
  return (
    <g>
      <mask id={`${id}-crescent`}>
        <rect width={64} height={64} fill="#fff" />
        <circle cx={x + r * 0.62} cy={y - r * 0.42} r={r * 0.86} fill="#000" />
      </mask>
      <circle cx={x} cy={y} r={r} fill={`url(#${id}-moon)`} mask={`url(#${id}-crescent)`} />
    </g>
  );
}
function Cloud({
  id,
  dark,
  dy = 0,
  dx = 0,
  scale = 1,
}: {
  id: string;
  dark?: boolean;
  dy?: number;
  dx?: number;
  scale?: number;
}) {
  return (
    <path
      d={CLOUD}
      transform={`translate(${dx} ${dy}) translate(32 38) scale(${scale}) translate(-32 -38)`}
      fill={`url(#${id}-${dark ? 'dark' : 'cloud'})`}
    />
  );
}
const drop = (x: number, y: number, length = 7, key?: number) => (
  <line
    key={key}
    x1={x}
    y1={y}
    x2={x - 2.2}
    y2={y + length}
    stroke="#3E9BF4"
    strokeWidth={3}
    strokeLinecap="round"
  />
);
const flake = (x: number, y: number, size = 3.6, key?: number) => (
  <g key={key} stroke="#8EC5F7" strokeWidth={2.1} strokeLinecap="round">
    {[0, 60, 120].map((angle) => {
      const rad = (angle * Math.PI) / 180;
      return (
        <line
          key={angle}
          x1={x - Math.cos(rad) * size}
          y1={y - Math.sin(rad) * size}
          x2={x + Math.cos(rad) * size}
          y2={y + Math.sin(rad) * size}
        />
      );
    })}
  </g>
);
const hail = (x: number, y: number, key?: number) => (
  <circle key={key} cx={x} cy={y} r={2.6} fill="#CFE6FB" stroke="#6FB2F2" strokeWidth={1.4} />
);

function body(icon: UiWeatherIcon, id: string): ReactNode {
  const up = -5;
  switch (icon) {
    case 'clear-day':
      return <Sun id={id} r={12} />;
    case 'clear-night':
      return <Moon id={id} x={30} y={33} r={16} />;
    case 'partly-cloudy-day':
      return (
        <>
          <Sun id={id} x={24} y={23} r={9} />
          <Cloud id={id} dx={4} dy={3} scale={0.92} />
        </>
      );
    case 'partly-cloudy-night':
      return (
        <>
          <Moon id={id} x={23} y={23} r={11} />
          <Cloud id={id} dx={4} dy={3} scale={0.92} />
        </>
      );
    case 'cloudy':
      return (
        <>
          <Cloud id={id} dark dx={7} dy={-7} scale={0.72} />
          <Cloud id={id} dy={2} />
        </>
      );
    case 'fog':
      return (
        <>
          <Cloud id={id} dy={-6} />
          <g stroke="#A3B1C4" strokeWidth={3} strokeLinecap="round">
            <line x1={14} y1={48} x2={44} y2={48} />
            <line x1={20} y1={55} x2={50} y2={55} />
          </g>
        </>
      );
    case 'drizzle':
      return (
        <>
          <Cloud id={id} dy={up} />
          {[22, 32, 42].map((x, index) => drop(x, 47 + (index % 2) * 3, 4, index))}
        </>
      );
    case 'rain':
      return (
        <>
          <Cloud id={id} dy={up} />
          {[23, 32, 41].map((x, index) => drop(x, 47 + (index % 2) * 2, 8, index))}
        </>
      );
    case 'heavy-rain':
      return (
        <>
          <Cloud id={id} dark dy={up} />
          {[19, 27, 35, 43].map((x, index) => drop(x, 46 + (index % 2) * 2, 11, index))}
        </>
      );
    case 'freezing-rain':
      return (
        <>
          <Cloud id={id} dy={up} />
          {drop(23, 47, 8)}
          {flake(33, 53)}
          {drop(43, 47, 8)}
        </>
      );
    case 'showers':
      return (
        <>
          <Sun id={id} x={22} y={20} r={8} />
          <Cloud id={id} dx={4} dy={-2} scale={0.9} />
          {[29, 39].map((x, index) => drop(x, 48, 8, index))}
        </>
      );
    case 'snow':
      return (
        <>
          <Cloud id={id} dy={up} />
          {[22, 32, 42].map((x, index) => flake(x, 51 + (index % 2) * 4, 3.6, index))}
        </>
      );
    case 'heavy-snow':
      return (
        <>
          <Cloud id={id} dark dy={up} />
          {[18, 28, 38, 46].map((x, index) => flake(x, 50 + (index % 2) * 5, 3.4, index))}
          {flake(33, 59, 2.8)}
        </>
      );
    case 'snow-showers':
      return (
        <>
          <Sun id={id} x={22} y={20} r={8} />
          <Cloud id={id} dx={4} dy={-2} scale={0.9} />
          {[29, 40].map((x, index) => flake(x, 52, 3.4, index))}
        </>
      );
    case 'thunderstorm':
      return (
        <>
          <Cloud id={id} dark dy={up} />
          <path
            d="M34 41l-8 11h6l-3 9 10-13h-6l3-7z"
            fill="#FFC53D"
            stroke="#F0A51A"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          {drop(20, 46, 7)}
          {drop(45, 46, 7)}
        </>
      );
    case 'hail':
      return (
        <>
          <Cloud id={id} dark dy={up} />
          {[22, 32, 42].map((x, index) => hail(x, 50 + (index % 2) * 5, index))}
          {drop(27, 55, 5)}
          {drop(38, 55, 5)}
        </>
      );
    default:
      return <Cloud id={id} />;
  }
}

export function WeatherIcon({
  icon,
  size = 40,
  label,
}: {
  icon: UiWeatherIcon;
  size?: number;
  label?: string;
}) {
  const id = `wx${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="dui-wx-icon"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <radialGradient id={`${id}-sun`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFE07A" />
          <stop offset="100%" stopColor="#F7A928" />
        </radialGradient>
        <linearGradient id={`${id}-moon`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF4C6" />
          <stop offset="100%" stopColor="#E3C97A" />
        </linearGradient>
        <linearGradient id={`${id}-cloud`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#CBD6E4" />
        </linearGradient>
        <linearGradient id={`${id}-dark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#AEB9C9" />
          <stop offset="100%" stopColor="#77869B" />
        </linearGradient>
      </defs>
      {body(icon, id)}
    </svg>
  );
}
