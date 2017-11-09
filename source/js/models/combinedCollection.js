// @flow
import SyncQueue from '../models/syncQueue.js'
import SyncGet from '../models/syncGet.js'
import Events from './events.js'
import { ListsCollection } from './listsCollection.js'
import { TasksCollection } from './tasksCollection.js'
import authenticationStore from '../stores/auth.js'
import { log } from '../helpers/logger.js'

const systemLists = ['inbox', 'today', 'next', 'all']

// helpers
export class combined extends Events {
  constructor() {
    super()
    // sets up the syncs here, just for greater control
    // also reduces dependencies
    this.listsQueue = new SyncQueue({
      identifier: 'lists',
      endpoint: 'lists',
      arrayParam: 'lists',
      model: ListsCollection,
      serverParams: ['name', 'notes']
    })
    ListsCollection.setSync(this.listsQueue)
    this.tasksQueue = new SyncQueue({
      identifier: 'tasks',
      endpoint: 'lists',
      arrayParam: 'tasks',
      parentModel: ListsCollection,
      model: TasksCollection,
      serverParams: ['name', 'notes']
    })
    TasksCollection.setSync(this.tasksQueue)

    this.syncGet = new SyncGet({
      lists: ListsCollection,
      tasks: TasksCollection
    })

    const handleProcess = function() {
      if (authenticationStore.isSignedIn(true)) {
        log('requested process: implement scheduler')
        this.processQueue()
      }
    }

    this.listsQueue.bind('request-process', handleProcess)
    this.tasksQueue.bind('request-process', handleProcess)

    authenticationStore.bind('token', this.downloadData)
    TasksCollection.bind('update', this._updateEvent('tasks'))
    ListsCollection.bind('update', this._updateEvent('lists'))
    ListsCollection.bind('order', this._orderEvent)
  }
  _updateEvent(key: string) {
    return (value: string) => {
      this.trigger('update', key, value)
    }
  }
  _orderEvent = (key: string) => {
    this.trigger('order', key)
  }
  downloadData = () => {
    this.syncGet.downloadLists().then(data => {
      this.syncGet.updateLocal(data)
    })
  }
  addTask(task: Object): Object | null {
    const list = ListsCollection.find(task.list)
    if (list === null) {
      throw new Error('List could not be found')
    } else if (task.list === 'today') {
      task.list = 'inbox'
      task.date = new Date()
      task.date.setSeconds(task.date.getSeconds()-1)
    } else if (task.list === 'next') {
      task.list = 'inbox'
      task.type = 'next'
    }
    const id = TasksCollection.add(task)
    // look up again because the list may have changed
    const order = ListsCollection.find(task.list).localOrder
    order.unshift(id)
    this.updateOrder(task.list, order, false)
    return this.getTask(id)
  }
  getTask(id: string, server: ?bool): Object | null {
    const task = TasksCollection.find(id, server)
    if (task === null) {
      return null
    }
    return task.toObject()
  }
  getTasks(id: string, sync: ?bool): Object | null {
    const list = ListsCollection.find(id, sync)
    if (list === null) {
      return null
    }
    const tasks = TasksCollection.findList(id, sync)
    let order = list.localOrder
    if (order.length !== tasks.length) {
      order = tasks.map(t => t.id)
    }
    return {
      tasks: tasks,
      order: order
    }
  }
  updateTask(id: string, newProps: Object): Object {
    const task = TasksCollection.update(id, newProps)
    if (task === null) throw new Error('Task could not be found')
    return task
  }
  completeTask(id: string, server: ?bool) {
    const task = this.getTask(id, server)
    if (task === null) throw new Error('Task could not be found')
    let completed = task.completed === null ? new Date() : null
    TasksCollection.update(task.id, { completed: completed })
  }
  deleteTask(id: string, server: ?bool) {
    const task = this.getTask(id, server)
    if (task === null) throw new Error('Task could not be found')
    const order = ListsCollection.find(task.list).localOrder
    order.splice(order.indexOf(task.id), 1)
    this.updateOrder(task.list, order, false)
    TasksCollection.delete(task.id)
  }
  updateOrder(id: string, order: Array<string>, sync: bool = true) {
    const resource = ListsCollection.find(id)

    // updates the local order, then the server order
    resource.localOrder = order
    resource.order = order
      .map(localId => {
        return TasksCollection.find(localId).serverId
      })
      .filter(item => item !== null)

    ListsCollection.trigger('order')
    ListsCollection.saveLocal()
    if (sync) ListsCollection.sync.patch(id)
  }
  addList(props: Object, sync: ?bool): Object {
    const newList = ListsCollection.add(props, sync)
    return newList.toObject()
  }
  getList(listId: string, serverId: ?bool): Object | null {
    let list = ListsCollection.find(listId, serverId)
    if (list === null) {
      return null
    }
    list = list.toObject()
    list.name = ListsCollection.escape(list.name)
    return list
  }
  getLists(): Array<Object> {
    const lists = []
    ListsCollection.all().forEach(list => {
      list = list.toObject()
      list.name = ListsCollection.escape(list.name)
      list.count = TasksCollection.findListCount(list.id)
      lists.push(list)
    })
    return lists
  }
  updateList(listId: string, props: Object) {
    if ('name' in props) {
      // reserved name
      if (props.name.slice(0, 9) === 'nitrosys-') {
        props.name = props.name.slice(9)
      }
    }
    ListsCollection.update(listId, props)
  }
  deleteList(listId: string, serverId: ?bool) {
    if (systemLists.indexOf(listId) !== -1) {
      throw new Error('Not allowed to delete system lists.')
    }
    const list = this.getList(listId, serverId)
    if (list === null) {
      throw new Error('List could not be found.')
    }
    TasksCollection.deleteAllFromList(list.id)
    ListsCollection.delete(list.id)
  }
}
export let CombinedCollection = new combined()
