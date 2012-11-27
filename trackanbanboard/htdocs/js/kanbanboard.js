var kanban = kanban || {};

kanban.Ticket = function(data) {
    console.log('new Ticket', data.id);
    var self = this;

    ko.mapping.fromJS(data, {
        copy: ['id']
    }, this);

    this.idString = ko.computed(function() {
        return '#' + self.id;
    });

    this.modifiedFields = [];
    this.setField = function(fieldName, value) {
        self[fieldName](value);
        self.modifiedFields.push(fieldName);
        if (self.changetime) {
            self.changetime(new Date().getTime());
        }
    };

    this.updateData = function(data) {
        console.log('Update ticket', data.id, data);
        ko.mapping.fromJS(data, self);

        if (kanban.rootModel) {
            var dt = kanban.rootModel.dialogTicket();
            if (dt && dt.id == self.id) {
                console.log('Update dialog ticket');
                kanban.rootModel.selectedTicket(self);
                kanban.rootModel.dialogTicket(ko.toJS(self));
            }
        }
    };

    console.log(this);
};

/*
    Serialize Ticket object. Only id and modified fields are included.
*/
kanban.Ticket.prototype.toJSON = function() {
    var obj = { id: this.id };
    for (var i in this.modifiedFields) {
        var fieldName = this.modifiedFields[i];
        obj[fieldName] = this[fieldName];
    }
    return obj;
};

kanban.Column = function(data) {
    console.log('new Column', data.id);
    var self = this;

    ko.mapping.fromJS(data, {
        copy: ['id', 'states'],
        'tickets': {
            key: function(ticketData) { return ko.utils.unwrapObservable(ticketData.id); },
            create: function(options) { return new kanban.Ticket(options.data); },
            update: function(options) {
                options.target.updateData(options.data);
                return options.target;
            }
        }
    }, this);

    this.tickets.id = data.id; // needed in sortable.afterMove function to find out source and target columns
    this.modifiedFields = [];

    this.updateData = function(data) {
        console.log('Update column', data.id, data);
        ko.mapping.fromJS(data, self);
    };

    console.log(this);
};

/*
 Serialize Column object. Only id and modified fields are included.
 */
kanban.Column.prototype.toJSON = function() {
    var obj = { id: this.id };
    for (var i in this.modifiedFields) {
        var fieldName = this.modifiedFields[i];
        obj[fieldName] = this[fieldName];
    }
    return obj;
};

kanban.Board = function(data) {
    console.log('new Board');
    var self = this;

    this.mapping = {
        'columns': {
            key: function(coldata) { return ko.utils.unwrapObservable(coldata.id); },
            create: function(options) { return new kanban.Column(options.data); },
            update: function(options) {
                options.target.updateData(options.data);
                return options.target;
            }
        }
    };

    ko.mapping.fromJS(data, this.mapping, this);

    /* The ticket clicked by user. */
    this.selectedTicket = ko.observable(null);
    /* The ticket displayed in ticket detail dialog. This is initially copy of selected ticket. */
    this.dialogTicket = ko.observable(null);

    /* Accepted values for various ticket fields. Keys are field names and values are observable arrays of strings.
       For example: { 'type': ko.observableArray(['defect, 'enhancement', 'task']) }*/
    this.ticketFieldOptions = {};

    this.setTicketFieldOptions = function(fieldName, options) {
        console.log('setTicketFieldOptions:', fieldName, options);

        // Add the "not defined" option
        for (var i in kanban.metadata.ticketFields) {
            if (fieldName == kanban.metadata.ticketFields[i].name &&
                kanban.metadata.ticketFields[i].kanbanOptional) {
                options.unshift('');
            }
        }

        self.ticketFieldOptions[fieldName] = ko.observableArray(options);
    };

    this.columnWidth = ko.computed(function() {
        return Math.floor(100 / self.columns().length) + '%';
    }, this);

    /* Called when card has been dragged to new position. */
    this.afterMove = function(arg) {
        var sourceColumn = self.getColumn(arg.sourceParent.id);
        sourceColumn.modifiedFields.push('tickets');
        var modifiedColumns = [sourceColumn];

        var targetColumn = self.getColumn(arg.targetParent.id);
        if (arg.sourceParent.id != arg.targetParent.id) {
            // Ticket's new status is the first mapped status of the column
            arg.item.setField('status', targetColumn.states[0]);
            targetColumn.modifiedFields.push('tickets');
            modifiedColumns.push(targetColumn);
        }

        kanban.request(
            kanban.DATA_URL,
            'POST',
            ko.toJSON(modifiedColumns),
            function(data) {console.log("updated");},
            function() {console.log("update error")});

        arg.item.modifiedFields = [];
        for (var i in modifiedColumns) {
            modifiedColumns[i].modifiedFields = [];
        }
    };

    /* Get column with ID 'id' */
    this.getColumn = function(id) {
        return ko.utils.arrayFirst(self.columns(), function(item) {
            return item.id == id;
        });
    };

    /* Get column which contains ticket with ID 'ticketId' */
    this.getTicketColumn = function(ticketId) {
        var cols = self.columns();
        for (var i in cols) {
            var col = cols[i];
            for (var j in col.tickets()) {
                var ticket = col.tickets()[j];
                if (ticket.id == ticketId) return cols[i];
            }
        }
        return null;
    };

    /* Get user friendly label for ticket field. */
    this.fieldLabel = function(fieldName) {
        for (var i in kanban.metadata.ticketFields) {
            if (kanban.metadata.ticketFields[i].name == fieldName) {
                return kanban.metadata.ticketFields[i].label;
            }
        }
        return "ERROR";
    };

    this.updateData = function(data) {
        console.log('Update board', data);
        ko.mapping.fromJS(data, self);
    };

    this.selectTicket = function(ticket) {
        console.log('selectTicket:', ticket);
        self.selectedTicket(ticket);
        /* Use copy of selected ticket in dialog so that original ticket doesn't change before Save is clicked. */
        self.dialogTicket(ko.toJS(ticket));
        self.showTicketDialog();
        self.fetchData([ ticket.id ]);
    };

    /* Fetch board data from backend. Data includes all columns and all tickets. By default ticket data includes
        only id, summary and status fields. For tickets specified in detailedTickets argument, all fields are included. */
    this.fetchData = function(detailedTickets) {
        console.log('fetchData:', detailedTickets, typeof detailedTickets);
        var args = '';
        if (detailedTickets && Object.prototype.toString.call(detailedTickets) === '[object Array]') {
            args = '?tickets=' + detailedTickets.join(',');
        }
        var url = kanban.DATA_URL + args;
        kanban.request(
            url,
            'GET',
            null,
            self.updateData,
            function() {
                console.error('Failed to fetch board data');
            });
    };

    this.showTicketDialog = function() {
        console.log('showTicketDialog');
        var buttons = {};
        if (IS_EDITABLE) {
            buttons['Remove from board'] = function() {
                self.removeTicket(self.selectedTicket().id);
                $(this).dialog("close");
            };
            buttons['Save'] = function() {
                self.saveDialogTicket(self.selectedTicket());
                $(this).dialog("close");
            };
        }
        buttons['Cancel'] = function() { $(this).dialog("close"); };

        var $dialogDiv = $('#ticketDialog');
        kanban.ticketDialog = $dialogDiv.dialog({
            modal: true,
            title: 'Ticket ' + self.dialogTicket().idString,
            minWidth: 600,
            buttons: buttons
        });
    };

    this.showQueryDialog = function() {
        console.log('showQueryDialog');
        $('#queryFrame').attr('src', kanban.QUERY_URL);
        var $dialogDiv = $('#queryDialog');
        kanban.queryDialog = $dialogDiv.dialog({
            title: 'Drag and drop ticket links to Kanban board',
            minWidth: 600,
            position: 'right'
        });
    };

    /* Check if dialog ticket has changed from original ticket and save changes if necessary */
    this.saveDialogTicket = function(originalTicket) {
        console.log('Save ticket:', self.dialogTicket(), originalTicket);

        var modified = false;
        var ticketColumn = self.getTicketColumn(originalTicket.id);

        for (var i in kanban.metadata.ticketFields) {
            var fieldName = kanban.metadata.ticketFields[i].name;
            if (fieldName == 'time' || fieldName == 'changetime') continue;
            if (self.dialogTicket()[fieldName] != originalTicket[fieldName]()) {
                originalTicket.setField(fieldName, self.dialogTicket()[fieldName]);
                modified = true;
            }
        }

        if (modified) {
            ticketColumn.modifiedFields.push('tickets');

            kanban.request(
                kanban.DATA_URL,
                'POST',
                ko.toJSON([ticketColumn]),
                function(data) {
                    console.log("updated", data);
                    self.updateData(data);
                },
                function() {console.log("update error")});

            originalTicket.modifiedFields = [];
            ticketColumn.modifiedFields = [];
        }
    };

    this.addTicket = function(ticketId) {
        console.log('Add ticket:', ticketId);

        var url = kanban.DATA_URL + '?add=' + ticketId;
        kanban.request(
            url,
            'GET',
            null,
            function(data) {
                console.log("added", data);
                self.updateData(data);
            },
            function() {console.log("add error")});
    };

    this.removeTicket = function(ticketId) {
        console.log('Remove ticket:', ticketId);

        var url = kanban.DATA_URL + '?remove=' + ticketId;
        kanban.request(
            url,
            'GET',
            null,
            function(data) {
                console.log("removed", data);
                self.updateData(data);
            },
            function() {console.log("remove error")});
    };
};

kanban.request = function(url, type, reqData, onSuccess, onError) {
    console.log('HTTP request:', url, type, reqData);
    $.ajax({
        type: type,
        url: url,
        contentType: 'application/json',
        data: reqData,
        dataType: 'json',
        success: onSuccess,
        error: onError
    });
};

kanban.onDataFetched = function(data) {
    console.log('Board data fetched:', data);
    kanban.rootModel = new kanban.Board(data);

    for (var i in kanban.metadata.ticketFields) {
        var field = kanban.metadata.ticketFields[i];
        if (field.options) {
            kanban.rootModel.setTicketFieldOptions(field.name, field.options);
        }
    }

    ko.bindingHandlers.sortable.isEnabled = IS_EDITABLE;
    ko.bindingHandlers.sortable.afterMove = kanban.rootModel.afterMove;
    ko.bindingHandlers.sortable.options = {
        placeholder: 'kanban-card-placeholder',
        forcePlaceholderSize: true,
        opacity: 0.5
    };
    ko.applyBindings(kanban.rootModel);

    $('.board-container').on('dragover', function(e) {
        // Default dragover behaviour must be canceled or else drop event is never fired
        e.stopPropagation();
        e.preventDefault();
        return false;
    }).on('drop', function(e) {
        e.stopPropagation();
        e.preventDefault();
        var id = kanbanutil.getTicketIdFromDropEvent(e, TRAC_PROJECT_NAME);
        if (id) {
            kanban.rootModel.addTicket(id);
        }
        return false;
    });
};

kanban.onDataFetchError = function(jqXHR, textStatus, error) {
    $('.kanban-column-container').html('<h2>' + textStatus + '</h2>');
};

$(document).ready(function(){
    console.log("Document ready. Board ID: " + KANBAN_BOARD_ID + ", " + (IS_EDITABLE ? "editable" : "read-only"));

    kanban.DATA_URL = '/' + TRAC_PROJECT_NAME + '/kanbanboard/' + KANBAN_BOARD_ID;
    kanban.QUERY_URL = '/' + TRAC_PROJECT_NAME + '/query?status=new&col=id&col=summary&col=status&col=type&col=priority&order=id';

    kanban.request(
        '/' + TRAC_PROJECT_NAME + '/kanbanboard/',
        'GET',
        null,
        function(data) {
            kanban.metadata = data;
            console.log(kanban.metadata);
            kanban.request(
                kanban.DATA_URL,
                'GET',
                null,
                kanban.onDataFetched,
                kanban.onDataFetchError);
        },
        function() {
            console.error('Failed to fetch project metadata');
        }
    );
});
