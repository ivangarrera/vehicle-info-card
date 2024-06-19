/* eslint-disable @typescript-eslint/no-explicit-any */
import { LitElement, html, TemplateResult, PropertyValues, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators';

// Custom Helpers
import {
  fireEvent,
  formatDateTime,
  formatNumber,
  forwardHaptic,
  hasConfigOrEntityChanged,
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceCardEditor,
  computeStateDisplay,
} from 'custom-card-helpers';

// Custom Types and Constants
import { ExtendedThemes, VehicleCardConfig, defaultConfig, EntityConfig, VehicleEntities } from './types';
import { cardTypes } from './const';

import * as DataKeys from './const/data-keys';
import * as StateMapping from './const/state-mapping';

// Styles and Assets
import styles from './css/styles.css';
import { amgBlack, amgWhite } from './const/imgconst';

// Components
import './components/map-card';
import './components/header-slide';
import './components/eco-chart';

// Functions
import { formatTimestamp } from './utils/helpers';
import { getVehicleEntities, setupCardListeners } from './utils/get-device-entities';

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'vehicle-info-card',
  name: 'Vehicle Card',
  preview: true,
  description: 'A custom card to display vehicle data with a map and additional cards.',
  documentationURL: 'https://github.com/ngocjohn/vehicle-info-card?tab=readme-ov-file#configuration',
});

const HELPERS = (window as any).loadCardHelpers ? (window as any).loadCardHelpers() : undefined;

@customElement('vehicle-info-card')
export class VehicleCard extends LitElement {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement('vehicle-info-card-editor');
  }

  @property({ attribute: false }) public hass!: HomeAssistant & { themes: ExtendedThemes };
  @property({ type: Object }) private config!: VehicleCardConfig;

  @state() private vehicleEntities: VehicleEntities = {};
  @state() private additionalCards: { [key: string]: any[] } = {};
  @state() private activeCardType: string | null = null;

  @property({ type: Boolean }) lockAttributesVisible = false;
  @property({ type: Boolean }) windowAttributesVisible = false;

  @state() private chargingInfoVisible = false;

  get isCharging() {
    return this.getEntityAttribute(this.vehicleEntities.rangeElectric?.entity_id, 'chargingactive');
  }

  // isCharging = true;

  get isDark(): boolean {
    return this.hass.themes.darkMode;
  }

  // https://lit.dev/docs/components/styles/
  public static get styles(): CSSResultGroup {
    return styles;
  }

  public static getStubConfig = (): Record<string, unknown> => {
    return {
      ...defaultConfig,
    };
  };

  public async setConfig(config: VehicleCardConfig): Promise<void> {
    if (!config) {
      throw new Error('Invalid configuration');
    }

    this.config = {
      ...config,
    };
    for (const cardType of cardTypes) {
      if (this.config[cardType.config]) {
        this.createCards(this.config[cardType.config], cardType.type);
      }
    }

    if (this.config.device_tracker) {
      const haMapConfig = {
        type: 'map',
        default_zoom: this.config.map_popup_config?.default_zoom,
        hours_to_show: this.config.map_popup_config?.hours_to_show,
        theme_mode: this.config.map_popup_config?.theme_mode,
        entities: [
          {
            entity: this.config.device_tracker,
          },
        ],
      };
      this.createCards([haMapConfig], 'mapDialog');
    }
  }

  public getCardSize(): number {
    return 3;
  }

  protected firstUpdated(changedProperties: PropertyValues) {
    super.firstUpdated(changedProperties);
    this.configureAsync();
  }

  private async configureAsync(): Promise<void> {
    this.vehicleEntities = await getVehicleEntities(this.hass, this.config);
    this.requestUpdate();
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.BenzCard = this;
  }

  disconnectedCallback(): void {
    if (window.BenzCard === this) {
      window.BenzCard = undefined;
    }
    super.disconnectedCallback();
  }

  private async createCards(cardConfigs: LovelaceCardConfig[], stateProperty: string): Promise<void> {
    if (HELPERS) {
      const helpers = await HELPERS;
      const cards = await Promise.all(
        cardConfigs.map(async (cardConfig) => {
          const element = await helpers.createCardElement(cardConfig);
          element.hass = this.hass;
          return element;
        }),
      );
      this.additionalCards[stateProperty] = cards;
    }
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (changedProps.has('hass')) {
      Object.values(this.additionalCards).forEach((cards) => {
        cards.forEach((card) => {
          card.hass = this.hass;
        });
      });
    }
    if (changedProps.has('activeCardType') && this.activeCardType !== 'mapDialog') {
      const cardElement = this.shadowRoot?.querySelector('.card-element');
      if (!cardElement) return;
      setupCardListeners(cardElement, this.toggleCard.bind(this));
    }
  }

  // https://lit.dev/docs/components/lifecycle/#reactive-update-cycle-performing
  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) {
      return false;
    }
    if (changedProps.has('hass')) {
      return true;
    }
    return hasConfigOrEntityChanged(this, changedProps, false);
  }

  /* -------------------------------------------------------------------------- */
  /* MAIN RENDER                                                                */
  /* -------------------------------------------------------------------------- */

  // https://lit.dev/docs/components/rendering/
  protected render(): TemplateResult | void {
    if (!this.config || !this.hass) {
      return html``;
    }

    const isDark = this.isDark ? 'dark' : '';
    const name = this.config.name || '';
    return html`
      <ha-card class=${isDark}>
        ${this._renderHeaderBackground()}
        <header>
          <h1>${name}</h1>
        </header>
        ${this.activeCardType ? this._renderCustomCard() : this._renderMainCard()}
      </ha-card>
    `;
  }

  private _renderHeaderBackground(): TemplateResult {
    if (!this.config.show_background || this.activeCardType !== null) return html``;
    const background = this.isDark ? amgWhite : amgBlack;

    return html` <div class="header-background" style="background-image: url(${background})"></div> `;
  }

  private _renderMainCard(): TemplateResult {
    return html`
      <main id="main-wrapper">
        <div class="header-info-box">
          ${this._renderWarnings()} ${this._renderChargingInfo()} ${this._renderRangeInfo()}
        </div>
        ${this._renderHeaderSlides()} ${this._renderMap()} ${this._renderButtons()}
      </main>
    `;
  }

  private _renderWarnings(): TemplateResult {
    const defaultIndicData = this.createDataArray([{ key: 'lockSensor' }, { key: 'parkBrake' }]);

    const defaultIdicator = defaultIndicData.map(({ state, icon }) => {
      return html`
        <div class="item">
          <ha-icon .icon=${icon}></ha-icon>
          <div><span>${state}</span></div>
        </div>
      `;
    });

    const addedChargingInfo = this.isCharging
      ? html` <div class="item chargeinfo" @click=${() => (this.chargingInfoVisible = !this.chargingInfoVisible)}>
          <ha-icon icon=${'mdi:ev-station'}></ha-icon>
          <div>
            <span>Charging</span>
            <div class="subcard-icon ${this.chargingInfoVisible ? 'active' : ''}" style="margin-bottom: 2px">
              <ha-icon icon="mdi:chevron-right"></ha-icon>
            </div>
          </div>
        </div>`
      : html``;

    return html`<div class="info-box">${defaultIdicator} ${addedChargingInfo}</div> `;
  }

  private _renderChargingInfo(): TemplateResult | void {
    const chargingData = this.createDataArray(DataKeys.chargingOverview);
    const chargingClass = this.chargingInfoVisible ? 'info-box charge active' : 'info-box charge';

    return html`
      <div class=${chargingClass} .hidden=${this.isCharging}>
        ${chargingData.map(({ name, state, icon }) => {
          if (state) {
            return html`
              <div class="item charge">
                <div>
                  <ha-icon .icon=${icon}></ha-icon>
                  <span>${state}</span>
                </div>
                <div class="item-name">
                  <span>${name}</span>
                </div>
              </div>
            `;
          } else {
            return html``;
          }
        })}
      </div>
    `;
  }

  private _renderRangeInfo(): TemplateResult | void {
    if (this.chargingInfoVisible) return;

    const { fuelLevel, rangeLiquid, rangeElectric, soc } = this.vehicleEntities;

    const fuelInfo = this.getEntityInfo(fuelLevel?.entity_id);
    const rangeLiquidInfo = this.getEntityInfo(rangeLiquid?.entity_id);
    const rangeElectricInfo = this.getEntityInfo(rangeElectric?.entity_id);
    const socInfo = this.getEntityInfo(soc?.entity_id);

    const renderInfoBox = (icon: string, state: string, unit: string, rangeState: string, rangeUnit: string) => html`
      <div class="info-box">
        <div class="item">
          <ha-icon icon="${icon}"></ha-icon>
          <div><span>${state} ${unit}</span></div>
        </div>
        <div class="fuel-wrapper">
          <div class="fuel-level-bar" style="width: ${state}%;"></div>
        </div>
        <div class="item">
          <span>${rangeState} ${rangeUnit}</span>
        </div>
      </div>
    `;

    if (fuelInfo.state && rangeLiquidInfo.state) {
      return renderInfoBox(
        'mdi:gas-station',
        fuelInfo.state,
        fuelInfo.unit,
        rangeLiquidInfo.state,
        rangeLiquidInfo.unit,
      );
    } else if (rangeElectricInfo.state && socInfo.state) {
      return renderInfoBox(
        'mdi:ev-station',
        socInfo.state,
        socInfo.unit,
        rangeElectricInfo.state,
        rangeElectricInfo.unit,
      );
    }
  }

  private _renderHeaderSlides(): TemplateResult {
    if (!this.config.images || !this.config.show_slides) return html``;

    const images: string[] = this.config.images;

    return html`<header-slide .images=${images}></header-slide>`;
  }

  private _renderMap(): TemplateResult | void {
    const { config, hass } = this;
    if (!config.show_map) {
      return;
    }
    if (!config.device_tracker && config.show_map) {
      return this._showWarning('No device_tracker entity provided.');
    }
    const darkMode = this.isDark;
    return html`
      <div id="map-box">
        <vehicle-map
          .hass=${hass}
          .darkMode=${darkMode}
          .apiKey=${this.config.google_api_key || ''}
          .deviceTracker=${config.device_tracker || ''}
          .popup=${config.enable_map_popup || false}
          @toggle-map-popup=${() => (this.activeCardType = 'mapDialog')}
        ></vehicle-map>
      </div>
    `;
  }

  private _renderEcoChart(): TemplateResult | void {
    if (this.activeCardType !== 'ecoCards') return html``;

    const ecoData = {
      bonusRange: parseFloat(this.getEntityState(this.vehicleEntities.ecoScoreBonusRange?.entity_id)) || 0,
      acceleration: parseFloat(this.getEntityState(this.vehicleEntities.ecoScoreAcceleraion?.entity_id)) || 0,
      constant: parseFloat(this.getEntityState(this.vehicleEntities.ecoScoreConstant?.entity_id)) || 0,
      freeWheel: parseFloat(this.getEntityState(this.vehicleEntities.ecoScoreFreeWheel?.entity_id)) || 0,
    };

    return html`<eco-chart .ecoData=${ecoData}></eco-chart>`;
  }

  private _renderButtons(): TemplateResult {
    if (!this.config.show_buttons) return html``;

    return html`
      <div class="grid-container">
        ${cardTypes.map(
          (cardType) => html`
            <div class="grid-item click-shrink" @click=${() => this.toggleCardFromButtons(cardType.type)}>
              <div class="item-icon">
                <ha-icon .icon="${cardType.icon}"></ha-icon>
              </div>
              <div class="item-content">
                <span class="primary">${cardType.name}</span>
                <span class="secondary">${this.getSecondaryInfo(cardType.type)}</span>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderCustomCard(): TemplateResult {
    if (!this.activeCardType) return html``;
    const { config } = this;
    const cardConfigMap = {
      tripCards: {
        config: config.trip_card,
        defaultRender: this._renderDefaultTripCard.bind(this),
      },
      vehicleCards: {
        config: config.vehicle_card,
        defaultRender: this._renderDefaultVehicleCard.bind(this),
      },
      ecoCards: {
        config: config.eco_card,
        defaultRender: this._renderDefaultEcoCard.bind(this),
      },
      tyreCards: {
        config: config.tyre_card,
        defaultRender: this._renderDefaultTyreCard.bind(this),
      },
      mapDialog: {
        config: [],
        defaultRender: () => this.additionalCards['mapDialog'],
      },
    };

    const cardInfo = cardConfigMap[this.activeCardType];

    if (!cardInfo) {
      return html``;
    }

    const isDefaultCard = !cardInfo.config || cardInfo.config.length === 0;
    const cards = isDefaultCard ? cardInfo.defaultRender() : this.additionalCards[this.activeCardType];

    const lastCarUpdate = config.entity ? this.hass.states[config.entity].last_changed : '';

    const formattedDate = this.hass.locale
      ? formatDateTime(new Date(lastCarUpdate), this.hass.locale)
      : formatTimestamp(lastCarUpdate);

    const cardHeaderBox = html` <div class="added-card-header">
      <div class="headder-btn click-shrink" @click="${() => this.toggleCard('close')}">
        <ha-icon icon="mdi:close"></ha-icon>
      </div>
      <div class="card-toggle">
        <div class="headder-btn click-shrink" @click=${() => this.toggleCard('prev')}>
          <ha-icon icon="mdi:chevron-left"></ha-icon>
        </div>
        <div class="headder-btn click-shrink" @click=${() => this.toggleCard('next')}>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </div>
      </div>
    </div>`;

    return html`
      <main id="cards-wrapper">
        ${cardHeaderBox}
        <section class="card-element">
          ${isDefaultCard ? cards : cards.map((card: any) => html`<div class="added-card">${card}</div>`)}
        </section>
        ${isDefaultCard ? html`<div class="last-update"><span>Last update: ${formattedDate}</span></div>` : ''}
      </main>
    `;
  }

  private _renderDefaultTripCard(): TemplateResult | void {
    const sections = [
      { title: 'Overview', data: this.createDataArray(DataKeys.tripOverview) },
      { title: 'From start', data: this.createDataArray(DataKeys.tripFromStart) },
      { title: 'From reset', data: this.createDataArray(DataKeys.tripFromReset) },
    ];

    return html` ${sections.map((section) => this.createItemDataRow(section.title, section.data))} `;
  }

  private _renderDefaultVehicleCard(): TemplateResult | void {
    const warningsData = this.createDataArray(DataKeys.vehicleWarnings);
    const overViewData = this.createDataArray(DataKeys.vehicleOverview);

    const toggleAttributes = (key: string) => {
      if (key === 'lockSensor') {
        this.lockAttributesVisible = !this.lockAttributesVisible;
      } else if (key === 'windowsClosed') {
        this.windowAttributesVisible = !this.windowAttributesVisible;
      } else {
        return;
      }
    };

    const subCardIconActive = (key: string): string => {
      if (['lockSensor', 'windowsClosed'].includes(key)) {
        const isVisible = key === 'lockSensor' ? this.lockAttributesVisible : this.windowAttributesVisible;
        return isVisible ? 'active' : '';
      }
      return 'hidden';
    };

    const subCardElements = (key: string): TemplateResult | null => {
      if (['lockSensor', 'windowsClosed'].includes(key)) {
        return key === 'lockSensor' ? this._renderLockAttributes() : this._renderWindowAttributes();
      }
      return null;
    };

    const toggleMoreInfo = (key: string) => {
      this.toggleMoreInfo(this.vehicleEntities[key]?.entity_id);
    };

    const renderDataRow = (key: string, name?: string, icon?: string, state?: string, active?: boolean) => html`
      <div class="data-row">
        <div>
          <ha-icon
            class="data-icon ${!active ? 'warning' : ''}"
            .icon="${icon}"
            @click=${() => toggleMoreInfo(key)}
          ></ha-icon>
          <span>${name}</span>
        </div>
        <div class="data-value-unit" @click=${() => toggleAttributes(key)}>
          <span class=${!active ? 'warning' : ''} style="text-transform: capitalize;">${state}</span>
          <ha-icon class="subcard-icon ${subCardIconActive(key)}" icon="mdi:chevron-right"></ha-icon>
        </div>
      </div>
      ${subCardElements(key)}
    `;

    const overViewItems = overViewData.map(({ key, name, icon, state, active }) =>
      renderDataRow(key, name, icon, state, active),
    );
    const subCardVisible = this.lockAttributesVisible || this.windowAttributesVisible;

    return html`
      <div class="default-card">
        <div class="data-header">Vehicle status</div>
        ${overViewItems}
      </div>
      <div class="default-card" .hidden=${subCardVisible}>
        <div class="data-header">Warnings</div>
        ${warningsData.map(
          ({ key, icon, state, name, active }) => html`
            <div class="data-row">
              <div>
                <ha-icon class="data-icon" .icon="${icon}" @click=${() => toggleMoreInfo(key)}></ha-icon>
                <span>${name}</span>
              </div>
              <div class="data-value-unit ${active ? 'error' : ''} " @click=${() => toggleMoreInfo(key)}>
                <span>${state}</span>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderDefaultEcoCard(): TemplateResult | void {
    const ecoData = this.createDataArray(DataKeys.ecoScores);

    return html`<div class="default-card">
        <div class="data-header">Eco display</div>
        ${this._renderEcoChart()}
      </div>
      ${this.createItemDataRow('Scores', ecoData)}`;
  }

  private _renderDefaultTyreCard(): TemplateResult | void {
    const tyreData = this.createDataArray(DataKeys.tyrePressures);
    return this.createItemDataRow('Tyre pressures', tyreData);
  }

  private _renderLockAttributes(): TemplateResult {
    const state: Record<string, any> = {};

    // Iterate over the keys of the lockAttrMapping object

    Object.keys(StateMapping.lockAttributeStates).forEach((attribute) => {
      const attributeState = this.getEntityAttribute(this.vehicleEntities.lockSensor?.entity_id, attribute);
      if (attributeState !== undefined && attributeState !== null) {
        state[attribute] = attributeState;
      }
    });

    const attributesClass = this.lockAttributesVisible ? 'sub-attributes active' : 'sub-attributes';

    // Render the lock attributes
    return html`
      <div class=${attributesClass}>
        ${Object.keys(state).map((attribute) => {
          const rawState = state[attribute];
          // Check if the state is valid and the attribute mapping exists
          if (rawState !== undefined && rawState !== null && StateMapping.lockAttributeStates[attribute]) {
            const readableState = StateMapping.lockAttributeStates[attribute].state[rawState] || 'Unknown';
            const classState = rawState ? 'warning' : '';
            return html`
              <div class="data-row">
                <span>${StateMapping.lockAttributeStates[attribute].name} </span>
                <div class="data-value-unit">
                  <span style="text-transform: capitalize" class="${classState}">${readableState}</span>
                </div>
              </div>
            `;
          }
          // Return nothing if the attribute state is not valid or attribute mapping does not exist
          return '';
        })}
      </div>
    `;
  }

  private _renderWindowAttributes(): TemplateResult {
    const windowAttributeStates: Record<string, any> = {};
    const windowsStateMapping = StateMapping.windowsAttributesState;

    // Iterate over the keys of the Windows object
    Object.keys(windowsStateMapping).forEach((attribute) => {
      const attributeState = this.getEntityAttribute(this.vehicleEntities.windowsClosed?.entity_id, attribute);
      if (attributeState !== undefined && attributeState !== null) {
        windowAttributeStates[attribute] = attributeState;
      }
    });

    const attributesClass = this.windowAttributesVisible ? 'sub-attributes active' : 'sub-attributes';

    // Render the window attributes
    return html`
      <div class=${attributesClass}>
        ${Object.keys(windowAttributeStates).map((attribute) => {
          const rawState = windowAttributeStates[attribute];
          // Check if the state is valid and the attribute mapping exists
          if (rawState !== undefined && rawState !== null && windowsStateMapping[attribute]) {
            const readableState = windowsStateMapping[attribute].state[rawState] || 'Unknown';
            return html`
              <div class="data-row">
                <span>${windowsStateMapping[attribute].name}</span>
                <div class="data-value-unit">
                  <span style="text-transform: capitalize">${readableState}</span>
                </div>
              </div>
            `;
          }
          // Return nothing if the attribute state is not valid or attribute mapping does not exist
          return '';
        })}
      </div>
    `;
  }

  private _showWarning(warning: string): TemplateResult {
    return html` <hui-warning>${warning}</hui-warning> `;
  }

  /* -------------------------------------------------------------------------- */
  /* ADDED CARD FUNCTIONALITY                                                   */
  /* -------------------------------------------------------------------------- */

  private toggleCard = (action?: 'next' | 'prev' | 'close'): void => {
    forwardHaptic('light');
    const cardElement = this.shadowRoot?.querySelector('.card-element') as HTMLElement;
    if (!this.activeCardType || !cardElement) return;
    if (action === 'next' || action === 'prev') {
      const currentIndex = cardTypes.findIndex((card) => card.type === this.activeCardType);
      const newIndex =
        action === 'next'
          ? (currentIndex + 1) % cardTypes.length
          : (currentIndex - 1 + cardTypes.length) % cardTypes.length;

      cardElement.style.animation = 'none';
      setTimeout(() => {
        this.activeCardType = cardTypes[newIndex].type;
        cardElement.style.animation = 'fadeIn 0.3s ease';
      }, 300);
      // this.activeCardType = cardTypes[newIndex].type;
    } else if (action === 'close') {
      this.activeCardType = null;
    }
  };

  private toggleCardFromButtons = (cardType: string): void => {
    forwardHaptic('light');
    setTimeout(() => {
      this.activeCardType = this.activeCardType === cardType ? null : cardType;
    }, 200);
  };

  /* -------------------------------------------------------------------------- */
  /* GET ENTITIES STATE AND ATTRIBUTES                                          */
  /* -------------------------------------------------------------------------- */

  private createItemDataRow = (title: string, data: EntityConfig[]): TemplateResult => {
    return html`
      <div class="default-card">
        <div class="data-header">${title}</div>
        ${data.map(({ key, name, icon, state }) => {
          if (key && name && state) {
            return html`
              <div class="data-row">
                <div>
                  <ha-icon class="data-icon" .icon="${icon}"></ha-icon>
                  <span>${name}</span>
                </div>
                <div class="data-value-unit" @click=${() => this.toggleMoreInfo(this.vehicleEntities[key]?.entity_id)}>
                  <span>${state}</span>
                </div>
              </div>
            `;
          } else {
            return html``;
          }
        })}
      </div>
    `;
  };

  private createDataArray = (keys: EntityConfig[]): ReturnType<VehicleCard['getEntityInfoByKey']>[] => {
    return keys.map((config) => this.getEntityInfoByKey(config));
  };

  private getEntityInfoByKey = ({ key, name, icon, unit, state }: EntityConfig): EntityConfig => {
    const vehicleEntity = this.vehicleEntities[key];

    if (!vehicleEntity) {
      return key === 'selectedProgram'
        ? {
            key,
            name: 'Program',
            icon: 'mdi:ev-station',
            state:
              StateMapping.chargeSelectedProgram[
                this.getEntityAttribute(this.vehicleEntities.rangeElectric?.entity_id, 'selectedChargeProgram')
              ],
            unit,
          }
        : { key, name, icon, state, unit };
    }

    const defaultInfo = {
      key,
      name: name ?? vehicleEntity.original_name,
      icon: icon ?? this.getEntityAttribute(vehicleEntity.entity_id, 'icon'),
      state: state ?? this.getStateDisplay(vehicleEntity.entity_id),
      unit: unit ?? this.getEntityAttribute(vehicleEntity.entity_id, 'unit_of_measurement'),
    };

    switch (key) {
      case 'soc': {
        const currentState = this.getEntityState(vehicleEntity.entity_id);
        const stateValue = currentState ? parseFloat(currentState) : 0;
        let socIcon: string;
        if (stateValue < 35) {
          socIcon = 'mdi:battery-charging-low';
        } else if (stateValue < 70) {
          socIcon = 'mdi:battery-charging-medium';
        } else {
          socIcon = 'mdi:battery-charging-high';
        }
        return { ...defaultInfo, icon: socIcon };
      }
      case 'maxSoc': {
        const maxSocState = this.getEntityState(vehicleEntity.entity_id);
        const maxSocStateValue = maxSocState ? parseFloat(maxSocState) : 0;
        const iconValue = Math.round(maxSocStateValue / 10) * 10;
        const maxSocIcon = `mdi:battery-charging-${iconValue}`;

        return { ...defaultInfo, icon: maxSocIcon };
      }

      case 'chargingPower': {
        const powerState = this.getEntityState(vehicleEntity.entity_id);
        const powerStateValue = powerState ? parseFloat(powerState) : 0;
        const powerStateUnit = this.getEntityAttribute(vehicleEntity.entity_id, 'unit_of_measurement') || 'kW';

        const powerStateDecimals = formatNumber(powerStateValue, this.hass.locale);
        const powerStateDislay = powerStateDecimals + ' ' + powerStateUnit;

        return { ...defaultInfo, state: powerStateDislay };
      }

      case 'parkBrake': {
        const parkBrakeState = this.getBooleanState(vehicleEntity.entity_id);
        return {
          ...defaultInfo,
          name: name ?? 'Parking brake',
          state: parkBrakeState ? 'Engaged' : 'Released',
          active: parkBrakeState,
        };
      }

      case 'windowsClosed': {
        let windowState: string;
        const windowsState = this.getBooleanState(vehicleEntity.entity_id);
        if (windowsState) {
          windowState = 'Closed';
        } else {
          const windowAttributeStates: Record<number, any> = {};

          Object.keys(StateMapping.windowsAttributesState).forEach((attribute) => {
            const attributeState = this.getEntityAttribute(vehicleEntity.entity_id, attribute);
            if (attributeState !== undefined && attributeState !== null) {
              windowAttributeStates[attribute] = attributeState;
            }
          });

          const openWindows = Object.keys(windowAttributeStates).filter(
            (attribute) => windowAttributeStates[attribute] === '0',
          );

          const totalOpenWindows = openWindows.length;
          windowState = `${totalOpenWindows} window${totalOpenWindows !== 1 ? 's' : ''} open`;
        }
        return {
          ...defaultInfo,
          name: name || 'Windows',
          state: windowState,
          active: windowsState,
        };
      }

      case 'ignitionState': {
        const shortValue = this.getEntityAttribute(vehicleEntity.entity_id, 'value_short');
        const realState = this.getEntityState(vehicleEntity.entity_id);
        const activeState = realState === '0' || realState === '1' ? true : false;
        return {
          ...defaultInfo,
          state: shortValue || 'Unknown',
          active: activeState,
        };
      }

      case 'lockSensor': {
        const lockState = this.getEntityState(vehicleEntity.entity_id);
        const lockStateFormatted = StateMapping.lockStates[lockState] || StateMapping.lockStates['4'];
        const lockIcon = lockState === '2' || lockState === '1' ? 'mdi:lock' : 'mdi:lock-open';

        return {
          ...defaultInfo,
          icon: lockIcon,
          state: lockStateFormatted,
          active: lockState === '2' || lockState === '1' ? true : false,
        };
      }

      default:
        if (DataKeys.vehicleWarnings.map((key) => key.key).includes(key)) {
          const warningState = this.getBooleanState(vehicleEntity.entity_id);

          return {
            ...defaultInfo,
            state: warningState ? 'Problem' : 'Ok',
            active: warningState,
          };
        }
        return defaultInfo;
    }
  };

  private getStateDisplay = (entityId: string | undefined): string => {
    if (!entityId || !this.hass.states[entityId] || !this.hass.locale) return '';
    return computeStateDisplay(this.hass.localize, this.hass.states[entityId], this.hass.locale);
  };

  private getSecondaryInfo = (cardType: string): string => {
    const { odometer, lockSensor, ecoScoreBonusRange } = this.vehicleEntities;

    switch (cardType) {
      case 'tripCards':
        return this.getStateDisplay(odometer?.entity_id);

      case 'vehicleCards':
        const lockedDisplayText =
          StateMapping.lockStates[this.getEntityState(lockSensor?.entity_id)] || StateMapping.lockStates['4'];
        return lockedDisplayText;

      case 'ecoCards':
        return this.getStateDisplay(ecoScoreBonusRange?.entity_id);

      case 'tyreCards':
        const secondaryInfoTyres = this.getMinMaxTyrePressure();
        return secondaryInfoTyres;

      default:
        return 'Unknown Card';
    }
  };

  /* --------------------------- GET INFO FROM HASS --------------------------- */

  private getEntityInfo = (entity: string): { state: string; unit: string } => {
    const state = this.getEntityState(entity);
    const unit = this.getEntityAttribute(entity, 'unit_of_measurement');
    return { state, unit };
  };

  private getBooleanState = (entity: string | undefined): boolean => {
    if (!entity || !this.hass.states[entity]) return false;
    return this.hass.states[entity].state === 'on';
  };

  private getEntityState = (entity: string | undefined): string => {
    if (!entity || !this.hass.states[entity]) return '';
    return this.hass.states[entity].state;
  };

  private getEntityAttribute = (entity: string | undefined, attribute: string): any => {
    if (!entity || !this.hass.states[entity] || !this.hass.states[entity].attributes) return undefined;
    return this.hass.states[entity].attributes[attribute];
  };

  private toggleMoreInfo = (entity: string): void => {
    fireEvent(this, 'hass-more-info', { entityId: entity });
  };

  private getMinMaxTyrePressure = () => {
    const { vehicleEntities } = this;
    const pressuresWithUnits = DataKeys.tyreAttributes.map((key) => ({
      pressure: this.getEntityState(vehicleEntities[key]?.entity_id) || '',
      unit: this.getEntityAttribute(vehicleEntities[key]?.entity_id, 'unit_of_measurement'),
    }));

    // Find the minimum and maximum pressures
    const minPressure = Math.min(...pressuresWithUnits.map(({ pressure }) => parseFloat(pressure)));
    const maxPressure = Math.max(...pressuresWithUnits.map(({ pressure }) => parseFloat(pressure)));

    // Format the minimum and maximum pressures with their original units
    const tireUnit = pressuresWithUnits[0]?.unit || '';
    const formattedMinPressure = minPressure % 1 === 0 ? minPressure.toFixed(0) : minPressure.toFixed(1);
    const formattedMaxPressure = maxPressure % 1 === 0 ? maxPressure.toFixed(0) : maxPressure.toFixed(1);
    return `${formattedMinPressure} - ${formattedMaxPressure} ${tireUnit}`;
  };
}
