// Filter dropdowns and the desk's toggles, drawn with base-ui (docs/adr/0021). The server still
// renders the native <select> and the links or buttons, so the page works without JavaScript.
// With it, these take their place: a select posts the same value, a toggle is the same link or button.

import { Select } from '@base-ui/react/select';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mounted = new WeakMap<Element, Root>();

function mount(el: Element, node: ReactNode) {
  if (mounted.has(el)) return;
  const root = createRoot(el);
  root.render(node);
  mounted.set(el, root);
}

function labelOf(select: HTMLSelectElement) {
  const own = select.labels?.[0]?.innerText?.trim();
  return own || select.getAttribute('aria-label') || select.name;
}

/** A filter <select>: the native one stays in the form (hidden) and receives the chosen value. */
function FilterSelect({ select }: { select: HTMLSelectElement }) {
  const options = [...select.options].map((option) => ({ value: option.value, label: option.text }));
  return (
    <Select.Root
      value={select.value}
      onValueChange={(value) => {
        if (value == null) return;
        select.value = String(value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }}
    >
      <Select.Trigger className="select select-sm base-select" aria-label={labelOf(select)}>
        <Select.Value />
        <Select.Icon className="base-select-icon">
          <svg viewBox="0 0 256 256" width="14" height="14" aria-hidden="true" fill="currentColor">
            <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="base-select-positioner" sideOffset={6}>
          <Select.Popup className="base-select-popup">
            <Select.List>
              {options.map((option) => (
                <Select.Item key={option.value || 'all'} value={option.value} className="base-select-item">
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function upgradeSelect(select: HTMLSelectElement) {
  if (select.dataset.baseSelect) return;
  select.dataset.baseSelect = 'true';
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const host = document.createElement('span');
  host.className = 'base-select-host';
  select.after(host);
  mount(host, <FilterSelect select={select} />);
}

function DispatchTabs({ group }: { group: HTMLElement }) {
  const tabs = [...group.querySelectorAll<HTMLButtonElement>('[data-prop-filter]')].map((button) => ({
    value: button.dataset.propFilter ?? '',
    label: button.textContent ?? '',
    pressed: button.getAttribute('aria-pressed') === 'true',
  }));
  const pressed = tabs.find((tab) => tab.pressed)?.value ?? 'all';
  return (
    <ToggleGroup className="dispatch-tabs base-toggle" aria-label={group.getAttribute('aria-label') ?? 'Show Properties'} value={[pressed]} render={<div role="group" />}>
      {tabs.map((tab) => (
        <Toggle key={tab.value} value={tab.value} className="dispatch-tab" render={<button type="button" data-prop-filter={tab.value} />}>
          {tab.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function upgradeDispatchTabs(group: HTMLElement) {
  if (group.dataset.baseToggle) return;
  group.dataset.baseToggle = 'true';
  const host = document.createElement('span');
  host.className = 'base-toggle-host';
  group.replaceWith(host);
  mount(host, <DispatchTabs group={group} />);
}

/** Upgrades the desk's filter dropdowns and toggles inside `root`. */
export function upgradeControls(root: ParentNode) {
  const scope = root instanceof Element || root instanceof Document ? root : document;
  for (const select of scope.querySelectorAll<HTMLSelectElement>('.filter-bar select:not([data-combobox]), .dispatch-pick select')) upgradeSelect(select);
  // Mine/All and the Schedule views stay real links: the page swap and the tests follow those hrefs.
  // The Dispatch property tabs are buttons, so they become a base-ui toggle group.
  for (const group of scope.querySelectorAll<HTMLElement>('.dispatch-tabs:not(.base-toggle)')) upgradeDispatchTabs(group);
}
