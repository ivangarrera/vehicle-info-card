// eslint-disable-next-line
const HELPERS = (window as any).loadCardHelpers ? (window as any).loadCardHelpers() : undefined;
import { LovelaceCardConfig } from 'custom-card-helpers';

import { combinedFilters, CARD_UPADE_SENSOR, CARD_VERSION } from '../const/const';
import { VehicleCardEditor } from '../editor';
import {
  HA as HomeAssistant,
  VehicleEntities,
  VehicleEntity,
  VehicleCardConfig,
  BaseButtonConfig,
  CustomButtonEntity,
  CardTypeConfig,
  ButtonCardEntity,
  AddedCards,
  MapData,
} from '../types';

import { baseDataKeys } from '../const/data-keys';
import { VehicleCard } from '../vehicle-info-card';
import { fetchLatestReleaseTag } from './loader';
import { getAddressFromGoggle, getAddressFromOpenStreet } from './helpers';
/**
 *
 * @param car
 * @returns
 */

export async function getVehicleEntities(
  hass: HomeAssistant,
  config: { entity: string },
  component: VehicleCard
): Promise<VehicleEntities> {
  const entityState = hass.states[config.entity];
  if (!entityState) {
    component._entityNotFound = true;
    console.log('Entity not found', component._entityNotFound);
  }

  const allEntities = await hass.callWS<Required<VehicleEntity>[]>({
    type: 'config/entity_registry/list',
  });
  const carEntity = allEntities.find((e) => e.entity_id === config.entity);
  if (!carEntity) {
    console.log('Car entity not found');
    return {};
  }

  const deviceEntities = allEntities
    .filter((e) => e.device_id === carEntity.device_id && e.hidden_by === null && e.disabled_by === null)
    .filter((e) => hass.states[e.entity_id] && !['unavailable', 'unknown'].includes(hass.states[e.entity_id].state));

  const entityIds: VehicleEntities = {};

  for (const entityName of Object.keys(combinedFilters)) {
    const { prefix, suffix } = combinedFilters[entityName];

    if (entityName === 'soc' || entityName === 'maxSoc') {
      const specialName = entityName === 'soc' ? 'State of Charge' : 'Max State of Charge';
      const entity = deviceEntities.find((e) => e.original_name === specialName);
      if (entity) {
        entityIds[entityName] = {
          entity_id: entity.entity_id,
          original_name: entity.original_name,
        };
      }
      continue;
    }

    const entity = deviceEntities.find((e) => {
      if (prefix) {
        return e.entity_id.startsWith(prefix) && e.entity_id.endsWith(suffix);
      }
      return e.unique_id.endsWith(suffix) || e.entity_id.endsWith(suffix);
    });

    if (entity) {
      entityIds[entityName] = {
        entity_id: entity.entity_id,
        original_name: entity.original_name,
      };
    }
  }
  return entityIds;
}

export async function getModelName(hass: HomeAssistant, entityCar: string): Promise<string> {
  // Fetch all entities
  const allEntities = await hass.callWS<{ entity_id: string; device_id: string }[]>({
    type: 'config/entity_registry/list',
  });
  // Find the car entity
  const carEntity = allEntities.find((entity) => entity.entity_id === entityCar);
  if (!carEntity) return '';
  console.log('Car Entity:', carEntity);
  const deviceId = carEntity.device_id;
  if (!deviceId) return '';

  // Fetch all devices
  const allDevices = await hass.callWS<{ id: string; name: string; model: string }[]>({
    type: 'config/device_registry/list',
  });
  // Find the device by ID
  const device = allDevices.find((device) => device.id === deviceId);
  if (!device) return '';
  console.log('Device:', device);
  return device.model || '';
}

/**
 * Update config with changed properties
 * @param config
 * @param changedProps
 **/

export function getCarEntity(hass: HomeAssistant): string {
  console.log('Getting car entity');
  const entities = Object.keys(hass.states).filter((entity) => entity.startsWith('sensor.') && entity.endsWith('_car'));
  return entities[0] || '';
}

export async function createCustomButtons(
  hass: HomeAssistant,
  button: BaseButtonConfig
): Promise<CustomButtonEntity | void> {
  if (!button) {
    return;
  }

  const stateValue = button.secondary
    ? await getTemplateValue(hass, button.secondary)
    : button.attribute && button.entity
      ? hass.formatEntityAttributeValue(hass.states[button.entity], button.attribute)
      : button.entity
        ? hass.formatEntityState(hass.states[button.entity])
        : '';

  const notify = button.notify ? await getBooleanTemplate(hass, button.notify) : false;

  const customButton: CustomButtonEntity = {
    enabled: true,
    hide: false,
    primary: button.primary,
    secondary: stateValue,
    icon: button.icon || '',
    notify,
    button_type: button.button_type || 'default',
    button_action: button.button_action,
    entity: button.entity || '',
    attribute: button.attribute || '',
  };

  return customButton;
}

export async function createCardElement(
  hass: HomeAssistant,
  cards: LovelaceCardConfig[]
): Promise<LovelaceCardConfig[]> {
  if (!cards) {
    return [];
  }

  // Load the helpers and ensure they are available
  let helpers;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).loadCardHelpers) {
    helpers = await (window as any).loadCardHelpers(); // eslint-disable-line
  } else if (HELPERS) {
    helpers = HELPERS;
  }

  // Check if helpers were loaded and if createCardElement exists
  if (!helpers || !helpers.createCardElement) {
    console.error('Card helpers or createCardElement not available.');
    return [];
  }

  const cardElements = await Promise.all(
    cards.map(async (card) => {
      try {
        const element = await helpers.createCardElement(card);
        element.hass = hass;
        return element;
      } catch (error) {
        console.error('Error creating card element:', error);
        return null;
      }
    })
  );
  return cardElements;
}

export async function getTemplateValue(hass: HomeAssistant, templateConfig: string): Promise<string> {
  if (!hass || !templateConfig) {
    return '';
  }

  try {
    // Prepare the body with the template
    const result = await hass.callApi<string>('POST', 'template', { template: templateConfig });
    return result;
  } catch (error) {
    throw new Error(`Error evaluating template: ${error}`);
  }
}

export async function getBooleanTemplate(hass: HomeAssistant, templateConfig: string): Promise<boolean> {
  if (!hass || !templateConfig) {
    return false;
  }

  try {
    // Prepare the body with the template
    const result = await hass.callApi<string>('POST', 'template', { template: templateConfig });
    if (result.trim().toLowerCase() === 'true') {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

export async function getDefaultButton(
  hass: HomeAssistant,
  config: VehicleCardConfig,
  baseCard: CardTypeConfig
): Promise<ButtonCardEntity> {
  const button = config[baseCard.button];
  const useCustom = config.use_custom_cards?.[baseCard.config] || false;
  const customCard = config[baseCard.config] !== undefined;

  const buttonCard = {
    key: baseCard.type,
    default_name: baseCard.name,
    default_icon: baseCard.icon,
    button: {
      hidden: button?.hide || false,
      button_action: button?.button_action || {},
      entity: button?.entity || '',
      icon: button?.icon || '',
      primary: button?.primary || '',
      secondary: button?.secondary || '',
      attribute: button?.attribute || '',
      notify: button?.notify || '',
    },
    button_type: button?.button_type || 'default',
    card_type: useCustom ? ('custom' as const) : ('default' as const),
    custom_button: button?.enabled || false,
    custom_card: customCard ? await createCardElement(hass, config[baseCard.config]) : [],
  };
  return buttonCard;
}

export async function getAddedButton(
  hass: HomeAssistant,
  addedCard: AddedCards[keyof AddedCards],
  key: string
): Promise<ButtonCardEntity> {
  const button = addedCard.button;
  const customCard = addedCard.cards && addedCard.cards.length > 0;

  const buttonCard = {
    key: key,
    custom_button: button.enabled ?? false,
    button: {
      hidden: button.hide ?? false,
      button_action: button?.button_action || {},
      entity: button.entity || '',
      icon: button.icon || '',
      primary: button.primary || '',
      secondary: button.secondary || '',
      attribute: button.attribute || '',
      notify: button.notify || '',
    },
    button_type: button.button_type || 'default',
    card_type: 'custom' as const,
    custom_card: customCard ? await createCardElement(hass, addedCard.cards) : [],
  };
  return buttonCard;
}

export async function handleFirstUpdated(editor: VehicleCardEditor): Promise<void> {
  if (!editor._latestRelease.version) {
    console.log('Fetching latest release');

    // Use Promise.all to run both async operations in parallel
    const [latestVersion, installed] = await Promise.all([
      fetchLatestReleaseTag(),
      installedByHACS(editor.hass as HomeAssistant),
    ]);

    // Update component data after both promises resolve
    editor._latestRelease.version = latestVersion;
    editor._latestRelease.hacs = !!installed;
    editor._latestRelease.updated = latestVersion === CARD_VERSION;
  } else {
    console.log('Latest release already fetched');
    return;
  }

  const updates: Partial<VehicleCardConfig> = {};

  if (!editor._config.entity || editor._config.entity === '') {
    console.log('Entity not found, fetching...');
    updates.entity = getCarEntity(editor.hass as HomeAssistant);
  }

  // After setting the entity, fetch the model name
  if (updates.entity || !editor._config.model_name) {
    const entity = updates.entity || editor._config.entity;
    updates.model_name = await getModelName(editor.hass as HomeAssistant, entity);
  }

  if (!editor._config.selected_language) {
    updates.selected_language = editor.hass.language;
    console.log('Selected language:', updates.selected_language);
  }

  if (Object.keys(updates).length > 0) {
    console.log('Updating config with:', updates);
    editor._config = { ...editor._config, ...updates };
    console.log('New config:', editor._config);
    editor._config = { ...editor._config, ...updates };
    editor.configChanged();
  }
}

export async function installedByHACS(hass: HomeAssistant): Promise<boolean> {
  const hacs = hass?.config?.components?.includes('hacs');
  if (!hacs) return false;
  const hacsEntities = await hass.callWS<{ entity_id: string }[]>({
    type: 'config/entity_registry/list',
  });

  const hacsEntity = hacsEntities.find((entity) => entity.entity_id === CARD_UPADE_SENSOR);
  return !!hacsEntity;
}

async function getMapData(hass: HomeAssistant, deviceTracker: string, apiKey: string): Promise<MapData> {
  const deviceStateObj = hass.states[deviceTracker];
  if (!deviceStateObj) {
    return { lat: 0, lon: 0, address: {} };
  }
  const { latitude, longitude } = deviceStateObj.attributes;
  const address = apiKey
    ? await getAddressFromGoggle(latitude, longitude, apiKey)
    : await getAddressFromOpenStreet(latitude, longitude);

  if (!address) {
    return { lat: latitude, lon: longitude, address: {} };
  }
  return { lat: latitude, lon: longitude, address };
}

async function createMapPopup(hass: HomeAssistant, config: VehicleCardConfig): Promise<LovelaceCardConfig[]> {
  const { default_zoom, hours_to_show, theme_mode } = config.map_popup_config || {};
  const haMapConfig = [
    {
      type: 'map',
      default_zoom: default_zoom || 14,
      hours_to_show: hours_to_show,
      theme_mode: theme_mode,
      entities: [
        {
          entity: config.device_tracker,
        },
      ],
    },
  ];
  return await createCardElement(hass, haMapConfig);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleCardFirstUpdated(component: any): Promise<void> {
  const hass = component._hass as HomeAssistant;
  const config = component.config as VehicleCardConfig;
  const card = component as VehicleCard;
  card.vehicleEntities = await getVehicleEntities(hass, config, component);
  card.DataKeys = baseDataKeys(card.userLang);
  if (config.show_map && config.device_tracker && card._currentPreviewType === null) {
    console.log('Fetching map data...');
    card.MapData = await getMapData(hass, config.device_tracker, config.google_api_key || '');
    if (config.enable_map_popup) {
      card.MapData.popUpCard = await createMapPopup(hass, config);
    } else {
      return;
    }
  }

  if (!card.vehicleEntities) {
    console.log('Vehicle entities not found, fetching...');

    console.log('No vehicle entities found');
    card._entityNotFound = true;
  }
}

// eslint-disable-next-line
export function deepMerge(target: any, source: VehicleCardConfig): VehicleCardConfig {
  const output = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] === null) {
      // If the source value is null, use the target's value
      output[key] = target[key];
    } else if (source[key] instanceof Object && key in target) {
      // If the value is an object and exists in the target, merge deeply
      output[key] = deepMerge(target[key], source[key]);
    } else {
      // Otherwise, use the source's value
      output[key] = source[key];
    }
  }

  return output;
}
